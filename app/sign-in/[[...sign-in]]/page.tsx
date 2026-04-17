import { SignIn } from "@clerk/nextjs";
import { AuthConfigCard } from "@/components/auth-config-card";
import { hasClerkPublishableKey } from "@/lib/auth";

export default function SignInPage() {
  if (!hasClerkPublishableKey) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-blue-50 to-indigo-100 px-6">
        <AuthConfigCard
          title="Sign in is not configured yet"
          description="This local app can render without Clerk, but the hosted authentication flow needs real Clerk keys before sign-in can work."
        />
      </div>
    );
  }

  return (
    <div className="flex items-center justify-center min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100">
      <SignIn />
    </div>
  );
}
