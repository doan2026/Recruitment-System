"""Configure/check Person 1 integrations using the ignored root .env; never print secrets."""

import argparse
import base64
import json
import re
import smtplib
import ssl
import sys
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
ENV_FILE = ROOT / ".env"


class IntegrationError(Exception):
    pass


class CloudinaryApiError(IntegrationError):
    def __init__(self, status, operation="", explanation=""):
        self.status = status
        suffix = f" during {operation}" if operation else ""
        detail = f": {explanation}" if explanation else ""
        super().__init__(f"Cloudinary API rejected the request (HTTP {status}){suffix}{detail}")


def read_env(path):
    if not path.is_file():
        raise IntegrationError(f"Missing configuration file: {path.name}")
    result = {}
    for line in path.read_text(encoding="utf-8-sig").splitlines():
        match = re.match(r"^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=(.*)$", line)
        if not match:
            continue
        key, value = match.groups()
        if key in result:
            raise IntegrationError(f"Duplicate setting: {key}")
        value = value.strip()
        if value.startswith(("'", '"')):
            quote = value[0]
            end = value.rfind(quote)
            if end <= 0 or (value[end + 1:].strip() and not value[end + 1:].strip().startswith("#")):
                raise IntegrationError(f"Invalid quoted setting: {key}")
            value = value[1:end]
        else:
            value = re.split(r"\s+#", value, maxsplit=1)[0].rstrip()
        result[key] = value
    return result


def configured(value):
    return bool(value and not re.search(
        r"(?i)replace[-_]|placeholder|changeme|your[-_]|^demo$|^test$|^dummy|^\$\{", value))


def required(env, key):
    value = env.get(key, "")
    if not configured(value):
        raise IntegrationError(f"Set {key} in the root .env first")
    return value


def write_settings(path, settings):
    # Validate the file before modifying it; preserve unrelated settings/comments.
    read_env(path)
    text = path.read_text(encoding="utf-8-sig")
    for key, value in settings.items():
        if "\n" in value or "\r" in value:
            raise IntegrationError(f"Invalid setting: {key}")
        pattern = re.compile(r"^\s*" + re.escape(key) + r"\s*=.*$", re.MULTILINE)
        if pattern.search(text):
            text = pattern.sub(lambda _: f"{key}={value}", text)
        else:
            text = text.rstrip("\n") + f"\n{key}={value}\n"
    path.write_text(text, encoding="utf-8", newline="\n")


def configure_gmail(env):
    username = required(env, "SMTP_USERNAME")
    password = required(env, "SMTP_PASSWORD").replace(" ", "")
    if not re.fullmatch(r"[^\s@]+@[^\s@]+\.[^\s@]+", username) or not re.fullmatch(r"[A-Za-z0-9]{16}", password):
        raise IntegrationError("Gmail needs an email address and a 16-character App Password")
    # Quote the app password so Compose cannot interpolate dollar signs.
    write_settings(ENV_FILE, {
        "SMTP_HOST": "smtp.gmail.com", "SMTP_PORT": "587", "SMTP_USERNAME": username,
        "SMTP_PASSWORD": f"'{password}'", "SMTP_FROM": username, "SMTP_AUTH": "true",
        "SMTP_STARTTLS": "true", "SMTP_STARTTLS_REQUIRED": "true",
    })
    print("Gmail configuration updated. Restart auth-service to apply it.")


def configure_google(env):
    client = required(env, "GOOGLE_CLIENT_ID")
    required(env, "GOOGLE_CLIENT_SECRET")
    if not client.endswith(".apps.googleusercontent.com"):
        raise IntegrationError("GOOGLE_CLIENT_ID must be a Web application OAuth client ID")
    write_settings(ENV_FILE, {
        "GOOGLE_OAUTH_ENABLED": "true",
        "GOOGLE_REDIRECT_URI": "http://localhost:3000/auth/google/callback",
        "GOOGLE_FRONTEND_REDIRECT_URI": "http://localhost:3000/auth/callback",
        "GOOGLE_SECURE_COOKIES": "false",
    })
    frontend_env = ROOT / "frontend/.env"
    if frontend_env.is_file():
        write_settings(frontend_env, {"NEXT_PUBLIC_GOOGLE_LOGIN_ENABLED": "true"})
    print("Google login enabled for localhost:3000. Rebuild frontend and restart auth-service.")


def check_smtp(env):
    if env.get("SMTP_HOST") != "smtp.gmail.com" or env.get("SMTP_PORT") != "587":
        raise IntegrationError("Run configure-gmail first")
    if any(env.get(key) != "true" for key in ("SMTP_AUTH", "SMTP_STARTTLS", "SMTP_STARTTLS_REQUIRED")):
        raise IntegrationError("Gmail requires authentication and STARTTLS")
    try:
        with smtplib.SMTP("smtp.gmail.com", 587, timeout=15) as client:
            client.ehlo()
            client.starttls(context=ssl.create_default_context())
            client.ehlo()
            client.login(required(env, "SMTP_USERNAME"), required(env, "SMTP_PASSWORD"))
    except smtplib.SMTPAuthenticationError as error:
        raise IntegrationError(f"Gmail authentication failed (SMTP {error.smtp_code}); no email sent") from None
    except (smtplib.SMTPException, OSError):
        raise IntegrationError("Gmail connection/TLS failed; no email sent") from None
    print("Gmail SMTP authentication: PASS (no email sent)")


def cloudinary_request(env, path, parameters=None):
    cloud = required(env, "CLOUDINARY_CLOUD_NAME")
    auth = required(env, "CLOUDINARY_API_KEY") + ":" + required(env, "CLOUDINARY_API_SECRET")
    if not re.fullmatch(r"[A-Za-z0-9_-]+", cloud):
        raise IntegrationError("Invalid Cloudinary cloud name")
    request = urllib.request.Request(
        "https://api.cloudinary.com/v1_1/" + cloud + path,
        data=None if parameters is None else urllib.parse.urlencode(parameters).encode(),
        headers={"Authorization": "Basic " + base64.b64encode(auth.encode()).decode()},
    )
    # Never forward credentials to a redirect location, even on another origin.
    class NoRedirect(urllib.request.HTTPRedirectHandler):
        def redirect_request(self, request, fp, code, message, headers, new_url):
            return None
    opener = urllib.request.build_opener(NoRedirect)
    try:
        with opener.open(request, timeout=15) as response:
            data = response.read(1024 * 1024 + 1)
            if len(data) > 1024 * 1024:
                raise IntegrationError("Cloudinary response exceeded the size limit")
            return json.loads(data)
    except urllib.error.HTTPError as error:
        explanation = ""
        try:
            explanation = json.loads(error.read(4096)).get("error", {}).get("message", "")
            if not isinstance(explanation, str):
                explanation = ""
            for key in ("CLOUDINARY_CLOUD_NAME", "CLOUDINARY_API_KEY", "CLOUDINARY_API_SECRET"):
                if env.get(key):
                    explanation = explanation.replace(env[key], "[hidden]")
            explanation = explanation.replace("\n", " ").replace("\r", " ")[:180]
        except (ValueError, AttributeError, OSError):
            pass
        raise CloudinaryApiError(error.code, request.get_method() + " " + path, explanation) from None
    except (urllib.error.URLError, OSError, ValueError):
        raise IntegrationError("Cloudinary connection/TLS/response failed") from None


def media_presets(env):
    # Read the service's policy source instead of maintaining a second policy table.
    source = (ROOT / "services/media-service/src/media/media-policy.ts").read_text(encoding="utf-8")
    expected = []
    for kind, body in re.findall(r"\[MediaType\.(\w+)\]: \{(.*?)\n  \},", source, re.DOTALL):
        setting = re.search(r"presetEnvironment: '([^']+)'", body).group(1)
        formats = re.findall(r"'([^']+)'", re.search(r"formats: \[([^\]]+)\]", body).group(1))
        delivery = re.search(r"deliveryType: StorageDeliveryType\.(\w+)", body).group(1).lower()
        maximum = int(re.search(r"maxBytes: (\d+) \* MIB", body).group(1)) * 1024 * 1024
        default_name = "recruitment_" + kind.lower() + "_signed"
        expected.append((env.get(setting) or default_name, formats, delivery, maximum))
    if len(expected) != 6:
        raise IntegrationError("Media policy changed; review preset validation before continuing")
    if len({item[0] for item in expected}) != len(expected):
        raise IntegrationError("Each media type must use a distinct upload preset name")
    return expected


def preset_matches(result, name, formats, delivery, maximum):
    options = result.get("options", result)
    actual_formats = options.get("allowed_formats", [])
    if isinstance(actual_formats, str):
        actual_formats = actual_formats.split(",")
    return (result.get("name") == name and result.get("unsigned") is False
            and sorted(actual_formats) == sorted(formats)
            and options.get("type") == delivery and options.get("max_file_size") == maximum)


def setup_cloudinary(env):
    if cloudinary_request(env, "/ping").get("status") != "ok":
        raise IntegrationError("Cloudinary returned an unexpected ping result")
    print("Cloudinary authenticated ping: PASS", flush=True)
    expected = media_presets(env)
    missing = []
    # Inspect every existing preset before making any changes. A failure or a
    # policy mismatch must never trigger a replacement of an existing preset.
    for preset in expected:
        name, formats, delivery, maximum = preset
        try:
            result = cloudinary_request(env, "/upload_presets/" + urllib.parse.quote(name, safe=""))
        except CloudinaryApiError as error:
            if error.status != 404:
                raise
            missing.append(preset)
        else:
            if not preset_matches(result, name, formats, delivery, maximum):
                raise IntegrationError(f"Existing preset {name} differs from policy; review it in Console")
            print(f"Preset {name}: already configured")
    for name, formats, delivery, maximum in missing:
        cloudinary_request(env, "/upload_presets", {
            "name": name, "unsigned": "false", "allowed_formats": ",".join(formats),
            "type": delivery, "max_file_size": str(maximum), "overwrite": "false",
        })
        result = cloudinary_request(env, "/upload_presets/" + urllib.parse.quote(name, safe=""))
        if not preset_matches(result, name, formats, delivery, maximum):
            raise IntegrationError(f"Created preset {name} failed policy verification")
        print(f"Preset {name}: created and verified")
    print("Cloudinary signed presets: READY (no media assets uploaded or deleted)")


def check_cloudinary(env, presets=False):
    if cloudinary_request(env, "/ping").get("status") != "ok":
        raise IntegrationError("Cloudinary returned an unexpected ping result")
    print("Cloudinary authenticated ping: PASS")
    if not presets:
        return
    failed = False
    for name, formats, delivery, maximum in media_presets(env):
        try:
            result = cloudinary_request(env, "/upload_presets/" + urllib.parse.quote(name, safe=""))
        except IntegrationError:
            print(f"Preset {name}: unavailable; check its name and API permissions")
            failed = True
            continue
        valid = preset_matches(result, name, formats, delivery, maximum)
        print(f"Preset {name}: {'PASS' if valid else 'POLICY MISMATCH'}")
        failed = failed or not valid
    if failed:
        raise IntegrationError("Fix the preset settings in Cloudinary Console before uploading real files")


def status(env):
    groups = {
        "Google login": ["GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET"],
        "Gmail SMTP": ["SMTP_USERNAME", "SMTP_PASSWORD"],
        "Cloudinary": ["CLOUDINARY_CLOUD_NAME", "CLOUDINARY_API_KEY", "CLOUDINARY_API_SECRET"],
    }
    for name, keys in groups.items():
        missing = [key for key in keys if not configured(env.get(key))]
        print(f"{name}: " + ("missing " + ", ".join(missing) if missing else "values present; live check still required"))
    print("Google enabled: " + str(env.get("GOOGLE_OAUTH_ENABLED") == "true"))
    print("Gmail transport selected: " + str(env.get("SMTP_HOST") == "smtp.gmail.com"))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("action", choices=["status", "configure-google", "configure-gmail", "check-smtp", "check-cloudinary", "setup-cloudinary"])
    parser.add_argument("--presets", action="store_true", help="Also read and validate the six Media upload presets")
    args = parser.parse_args()
    try:
        env = read_env(ENV_FILE)
        if args.action == "check-cloudinary":
            check_cloudinary(env, args.presets)
        elif args.action == "setup-cloudinary":
            setup_cloudinary(env)
        else:
            {"status": status, "configure-google": configure_google, "configure-gmail": configure_gmail,
             "check-smtp": check_smtp}[args.action](env)
    except IntegrationError as error:
        print(f"NOT READY: {error}", file=sys.stderr)
        return 1
    except Exception:
        # Do not leak URLs, headers, file content or provider responses via a traceback.
        print("NOT READY: integration check failed; review the configuration locally", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
