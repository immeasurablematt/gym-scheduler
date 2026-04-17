import { SignUp } from "@clerk/nextjs";
import { AuthConfigCard } from "@/components/auth-config-card";
import { hasClerkPublishableKey } from "@/lib/auth";

export default function SignUpPage() {
  if (!hasClerkPublishableKey) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-blue-50 to-indigo-100 px-6">
        <AuthConfigCard
          title="Sign up is not configured yet"
          description="The rest of the UI can be tested locally, but account creation needs Clerk keys in your local environment first."
        />
      </div>
    );
  }

  return (
    <div className="flex items-center justify-center min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100">
      <SignUp />
    </div>
  );
}
