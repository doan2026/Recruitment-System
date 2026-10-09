import { NextResponse } from "next/server";

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const gateway = process.env.API_INTERNAL_BASE_URL || "http://api-gateway:8080";
    
    const res = await fetch(`${gateway}/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body)
    });
    
    const text = await res.text();
    let data;
    try {
      data = JSON.parse(text);
    } catch (e) {
      return NextResponse.json({ code: "PARSE_ERROR", message: "Invalid JSON from gateway", details: text }, { status: res.status });
    }
    
    let accessToken = null;
    let refreshToken = null;
    
    if (res.ok && data.data?.accessToken) {
      accessToken = data.data.accessToken;
      refreshToken = data.data.refreshToken;
      delete data.data.accessToken;
      delete data.data.refreshToken;
    }
    
    const response = NextResponse.json(data, { status: res.status });
    
    if (res.ok && accessToken) {
      response.cookies.set("careerhub_token", accessToken, { 
        httpOnly: true, 
        sameSite: "lax",
        path: "/",
        maxAge: 60 * 60 * 24 * 7 // 7 days
      });
      if (refreshToken) {
        response.cookies.set("careerhub_refresh", refreshToken, { 
          httpOnly: true, 
          sameSite: "lax",
          path: "/api/auth-cookie/refresh",
          maxAge: 60 * 60 * 24 * 7
        });
      }
    }
    
    return response;
  } catch (error: any) {
    return NextResponse.json({ code: "NETWORK_ERROR", message: "Cannot connect to auth service", details: error.message }, { status: 500 });
  }
}
