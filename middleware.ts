import { clerkMiddleware, createRouteMatcher } from '@clerk/nextjs/server'
import { hasClerkServerKeys } from '@/lib/auth'
import { NextResponse } from 'next/server'

const isProtectedRoute = createRouteMatcher([
  '/dashboard(.*)',
  '/onboarding(.*)',
  '/sessions(.*)',
  '/schedule(.*)',
  '/payments(.*)',
  '/profile(.*)',
])

const isPublicRoute = createRouteMatcher([
  '/',
  '/sign-in(.*)',
  '/sign-up(.*)',
  '/api/webhook(.*)',
  '/api/twilio/inbound',
])

const isApiRoute = createRouteMatcher([
  '/api/(.*)',
])

const isWebhookRoute = createRouteMatcher([
  '/api/webhook(.*)',
  '/api/twilio/inbound',
])

export default clerkMiddleware(async (auth, req) => {
  if (!hasClerkServerKeys) {
    return NextResponse.next()
  }

  const { userId, sessionClaims } = await auth()
  const onboardingComplete = Boolean(
    (sessionClaims?.metadata as { onboardingComplete?: boolean } | undefined)
      ?.onboardingComplete
  )
  
  if (!userId && (isProtectedRoute(req) || (isApiRoute(req) && !isWebhookRoute(req)))) {
    const signInUrl = new URL('/sign-in', req.url)
    signInUrl.searchParams.set('redirect_url', req.url)
    return NextResponse.redirect(signInUrl)
  }

  if (userId && !onboardingComplete) {
    const onboardingUrl = new URL('/onboarding', req.url)
    
    if (!req.url.includes('/onboarding') && !isPublicRoute(req)) {
      return NextResponse.redirect(onboardingUrl)
    }
  }

  return NextResponse.next()
})

export const config = {
  matcher: [
    '/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)',
    '/(api|trpc)(.*)',
  ],
}
