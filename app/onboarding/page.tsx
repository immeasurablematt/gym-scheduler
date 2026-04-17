import { PlaceholderPage } from "@/components/placeholder-page";

export default function OnboardingPage() {
  return (
    <main className="mx-auto flex min-h-screen max-w-5xl items-center px-6 py-16">
      <PlaceholderPage
        eyebrow="Onboarding"
        title="Finish your gym setup"
        description="This placeholder keeps the onboarding redirect path valid while the full setup flow is still being built."
      />
    </main>
  );
}
