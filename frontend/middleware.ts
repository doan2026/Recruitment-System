import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

export function middleware(request: NextRequest) {
  if (request.nextUrl.pathname.startsWith('/api/') && !request.nextUrl.pathname.startsWith('/api/auth-cookie/')) {
    const token = request.cookies.get('careerhub_token')?.value;
    
    // Create new headers object containing all existing headers
    const requestHeaders = new Headers(request.headers);
    
    // Inject Authorization header if token exists
    if (token) {
      requestHeaders.set('Authorization', `Bearer ${token}`);
    }
    
    return NextResponse.next({
      request: {
        headers: requestHeaders,
      },
    });
  }
  
  return NextResponse.next();
}
