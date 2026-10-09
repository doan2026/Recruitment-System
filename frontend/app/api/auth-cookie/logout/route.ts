import { cookies } from "next/headers";
import { NextResponse } from "next/server";

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const cookieStore = cookies();
    const presentedRefresh = body.refreshToken || cookieStore.get("careerhub_refresh")?.value;
    
    const gateway = process.env.API_INTERNAL_BASE_URL || "http://api-gateway:8080";
    
    let status = 200;
    
    if (presentedRefresh) {
      const res = await fetch(`${gateway}/auth/logout`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ refreshToken: presentedRefresh })
      });
      status = res.status;
    }
    
    const response = NextResponse.json({ success: true }, { status });
    response.cookies.delete("careerhub_token");
    response.cookies.set("careerhub_refresh", "", { expires: new Date(0), path: "/api/auth-cookie/refresh" });
    
    return response;
  } catch (error) {
    const response = NextResponse.json({ success: true }, { status: 200 });
    response.cookies.delete("careerhub_token");
    response.cookies.set("careerhub_refresh", "", { expires: new Date(0), path: "/api/auth-cookie/refresh" });
    return response;
  }
}
