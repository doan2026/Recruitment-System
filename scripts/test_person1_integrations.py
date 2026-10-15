import contextlib
import io
import tempfile
import unittest
import urllib.error
from pathlib import Path
from unittest.mock import patch

import person1_integrations as integrations


class CloudinarySetupTest(unittest.TestCase):
    def response(self, preset, nested=True):
        name, formats, delivery, maximum = preset
        options = {"allowed_formats": formats, "type": delivery, "overwrite": False}
        return {"name": name, "unsigned": False, **({"settings": options} if nested else options)}

    def test_policy_requires_private_pdf_and_six_distinct_signed_presets(self):
        presets = integrations.media_presets({})
        self.assertEqual(len(presets), 6)
        cv = next(item for item in presets if item[0] == "recruitment_cv_signed")
        self.assertEqual(cv[1:], (["pdf"], "authenticated", 5 * 1024 * 1024))
        for preset in presets:
            self.assertTrue(integrations.preset_matches(self.response(preset), *preset))
            self.assertTrue(integrations.preset_matches(self.response(preset, nested=False), *preset))

    def test_auth_failure_never_creates_presets(self):
        with patch.object(integrations, "cloudinary_request", side_effect=integrations.CloudinaryApiError(401)) as request:
            with self.assertRaises(integrations.CloudinaryApiError):
                integrations.setup_cloudinary({})
            self.assertEqual(request.call_count, 1)
            self.assertEqual(request.call_args.args, ({}, "/ping"))

    def test_provider_error_redacts_credentials(self):
        env = {"CLOUDINARY_CLOUD_NAME": "test-cloud", "CLOUDINARY_API_KEY": "123456789",
               "CLOUDINARY_API_SECRET": "private-secret"}
        body = b'{"error":{"message":"rejected private-secret for 123456789"}}'
        error = urllib.error.HTTPError("https://api.cloudinary.com/", 403, "Forbidden", {}, io.BytesIO(body))
        with patch.object(integrations.urllib.request, "build_opener") as factory:
            factory.return_value.open.side_effect = error
            with self.assertRaises(integrations.CloudinaryApiError) as result:
                integrations.cloudinary_request(env, "/upload_presets")
        message = str(result.exception)
        self.assertIn("HTTP 403", message)
        self.assertNotIn(env["CLOUDINARY_API_KEY"], message)
        self.assertNotIn(env["CLOUDINARY_API_SECRET"], message)

    def test_incompatible_existing_preset_is_not_overwritten(self):
        first = integrations.media_presets({})[0]
        incompatible = self.response(first)
        incompatible["unsigned"] = True
        with patch.object(integrations, "cloudinary_request", side_effect=[{"status": "ok"}, incompatible]) as request:
            with self.assertRaises(integrations.IntegrationError):
                integrations.setup_cloudinary({})
            self.assertTrue(all(len(call.args) == 2 for call in request.call_args_list))

    def test_forbidden_read_is_not_treated_as_missing_preset(self):
        with patch.object(integrations, "cloudinary_request", side_effect=[{"status": "ok"}, integrations.CloudinaryApiError(403)]) as request:
            with self.assertRaises(integrations.CloudinaryApiError):
                integrations.setup_cloudinary({})
            self.assertEqual(request.call_count, 2)

    def test_setup_creates_only_missing_presets_and_is_repeatable(self):
        presets = integrations.media_presets({})
        remote = {item[0]: self.response(item) for item in presets[1:]}
        writes = []

        def request(env, path, parameters=None):
            if path == "/ping":
                return {"status": "ok"}
            if parameters is not None:
                writes.append(parameters)
                remote[parameters["name"]] = self.response(presets[0])
                return remote[parameters["name"]]
            name = path.rsplit("/", 1)[-1]
            if name not in remote:
                raise integrations.CloudinaryApiError(404)
            return remote[name]

        with patch.object(integrations, "cloudinary_request", side_effect=request), contextlib.redirect_stdout(io.StringIO()):
            integrations.setup_cloudinary({})
            integrations.setup_cloudinary({})
        self.assertEqual(len(writes), 1)
        self.assertEqual(writes[0]["unsigned"], "false")
        self.assertEqual(writes[0]["type"], "authenticated")
        self.assertNotIn("max_file_size", writes[0])
        self.assertEqual(writes[0]["overwrite"], "false")

    def test_preset_validation_rejects_wrong_policy_and_malformed_settings(self):
        preset = integrations.media_presets({})[0]
        for field, value in [("allowed_formats", ["jpg"]), ("allowed_formats", 1), ("type", "upload")]:
            result = self.response(preset)
            result["settings"][field] = value
            self.assertFalse(integrations.preset_matches(result, *preset))
        result = self.response(preset)
        result["options"] = result.pop("settings")
        self.assertTrue(integrations.preset_matches(result, *preset))

    def test_quoted_credentials_are_read_without_logging_and_other_settings_survive(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / ".env"
            path.write_text("CLOUDINARY_API_SECRET='private$token'\nSMTP_HOST=mailhog\n", encoding="utf-8")
            self.assertEqual(integrations.read_env(path)["CLOUDINARY_API_SECRET"], "private$token")
            integrations.write_settings(path, {"CLOUDINARY_CLOUD_NAME": "test-cloud"})
            self.assertEqual(integrations.read_env(path)["SMTP_HOST"], "mailhog")
            self.assertEqual(integrations.read_env(path)["CLOUDINARY_API_SECRET"], "private$token")


if __name__ == "__main__":
    unittest.main()
