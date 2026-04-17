import Link from "next/link";
import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import { hasClerkPublishableKey, hasClerkServerKeys } from "@/lib/auth";
import { Calendar, Users, Clock, TrendingUp, Shield, Zap } from "lucide-react";

export default async function Home() {
  if (hasClerkServerKeys) {
    const { userId } = await auth();

    if (userId) {
      redirect("/dashboard");
    }
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 via-white to-purple-50">
      {/* Navigation */}
      <nav className="flex justify-between items-center px-6 py-4 bg-white/80 backdrop-blur-sm border-b">
        <div className="flex items-center space-x-2">
          <Zap className="h-8 w-8 text-blue-600" />
          <span className="text-2xl font-bold text-gray-900">GymScheduler</span>
        </div>
        <div className="flex items-center space-x-4">
          <Link
            href="/sign-in"
            className="px-4 py-2 font-medium text-gray-700 hover:text-gray-900"
          >
            Sign In
          </Link>
          <Link
            href="/sign-up"
            className="rounded-lg bg-blue-600 px-6 py-2 font-medium text-white hover:bg-blue-700"
          >
            Get Started
          </Link>
        </div>
      </nav>

      {/* Hero Section */}
      <section className="px-6 py-20 text-center max-w-6xl mx-auto">
        <h1 className="text-5xl font-bold text-gray-900 mb-6">
          Smart Gym Scheduling for Personal Trainers
        </h1>
        <p className="text-xl text-gray-600 mb-8 max-w-3xl mx-auto">
          Efficiently manage your training sessions, coordinate with clients, and optimize gym space usage—all in one intelligent platform.
        </p>
        {!hasClerkPublishableKey && (
          <div className="mx-auto mb-8 max-w-2xl rounded-2xl border border-amber-200 bg-amber-50 px-6 py-4 text-left text-sm text-amber-900">
            Authentication keys are not configured locally yet, so sign-in and
            sign-up routes will show setup guidance while the rest of the app
            remains testable.
          </div>
        )}
        <div className="flex justify-center space-x-4">
          <Link
            href="/sign-up"
            className="rounded-lg bg-blue-600 px-8 py-4 text-lg font-semibold text-white shadow-lg hover:bg-blue-700"
          >
            Start Free Trial
          </Link>
          <Link href="#features">
            <span className="inline-flex rounded-lg border-2 border-blue-600 bg-white px-8 py-4 text-lg font-semibold text-blue-600 hover:bg-gray-50">
              Learn More
            </span>
          </Link>
        </div>
      </section>

      {/* Features Section */}
      <section id="features" className="px-6 py-20 bg-white">
        <div className="max-w-6xl mx-auto">
          <h2 className="text-4xl font-bold text-center text-gray-900 mb-12">
            Everything You Need to Manage Your Training Business
          </h2>
          <div className="grid md:grid-cols-3 gap-8">
            <FeatureCard
              icon={<Calendar className="h-12 w-12 text-blue-600" />}
              title="Smart Scheduling"
              description="AI-powered scheduling with conflict detection and automatic optimization for maximum efficiency."
            />
            <FeatureCard
              icon={<Users className="h-12 w-12 text-blue-600" />}
              title="Client Management"
              description="Track up to 10 clients per trainer with goals, progress, and personalized workout plans."
            />
            <FeatureCard
              icon={<Clock className="h-12 w-12 text-blue-600" />}
              title="Real-time Updates"
              description="Instant notifications for schedule changes, cancellations, and session reminders."
            />
            <FeatureCard
              icon={<TrendingUp className="h-12 w-12 text-blue-600" />}
              title="Payment Processing"
              description="Integrated Stripe payments with automatic invoicing and payment tracking."
            />
            <FeatureCard
              icon={<Shield className="h-12 w-12 text-blue-600" />}
              title="Secure & Reliable"
              description="Bank-level security with Clerk authentication and Supabase database."
            />
            <FeatureCard
              icon={<Zap className="h-12 w-12 text-blue-600" />}
              title="3D Gym Visualization"
              description="Interactive 3D view of gym spaces to optimize equipment and space usage."
            />
          </div>
        </div>
      </section>

      {/* Pricing Section */}
      <section className="px-6 py-20 bg-gradient-to-br from-blue-50 to-purple-50">
        <div className="max-w-4xl mx-auto text-center">
          <h2 className="text-4xl font-bold text-gray-900 mb-12">
            Simple, Transparent Pricing
          </h2>
          <div className="grid md:grid-cols-2 gap-8">
            <PricingCard
              title="Trainer"
              price="$29"
              period="/month"
              features={[
                "Up to 10 clients",
                "Unlimited sessions",
                "Email notifications",
                "Payment processing",
                "Basic analytics",
              ]}
            />
            <PricingCard
              title="Gym Owner"
              price="$99"
              period="/month"
              features={[
                "Up to 4 trainers",
                "40 total clients",
                "3D gym visualization",
                "Advanced analytics",
                "Priority support",
                "Custom branding",
              ]}
              highlighted={true}
            />
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="px-6 py-12 bg-gray-900 text-white">
        <div className="max-w-6xl mx-auto flex justify-between items-center">
          <div className="flex items-center space-x-2">
            <Zap className="h-6 w-6 text-blue-400" />
            <span className="text-xl font-bold">GymScheduler</span>
          </div>
          <div className="text-sm text-gray-400">
            © 2024 GymScheduler. All rights reserved.
          </div>
        </div>
      </footer>
    </div>
  );
}

function FeatureCard({ icon, title, description }: { icon: React.ReactNode; title: string; description: string }) {
  return (
    <div className="p-6 bg-gray-50 rounded-xl hover:shadow-lg transition-shadow">
      <div className="mb-4">{icon}</div>
      <h3 className="text-xl font-semibold text-gray-900 mb-2">{title}</h3>
      <p className="text-gray-600">{description}</p>
    </div>
  );
}

function PricingCard({ 
      title, 
      price, 
      period, 
      features, 
      highlighted = false 
}: { 
  title: string; 
  price: string; 
  period: string; 
  features: string[]; 
  highlighted?: boolean;
}) {
  return (
    <div className={`p-8 rounded-xl ${highlighted ? 'bg-blue-600 text-white shadow-xl scale-105' : 'bg-white border-2 border-gray-200'}`}>
      <h3 className={`text-2xl font-bold mb-4 ${highlighted ? 'text-white' : 'text-gray-900'}`}>
        {title}
      </h3>
      <div className="mb-6">
        <span className={`text-4xl font-bold ${highlighted ? 'text-white' : 'text-gray-900'}`}>
          {price}
        </span>
        <span className={highlighted ? 'text-blue-100' : 'text-gray-600'}>
          {period}
        </span>
      </div>
      <ul className="space-y-3 mb-8">
        {features.map((feature, index) => (
          <li key={index} className="flex items-start">
            <span className={`mr-2 ${highlighted ? 'text-blue-100' : 'text-blue-600'}`}>✓</span>
            <span className={highlighted ? 'text-white' : 'text-gray-700'}>{feature}</span>
          </li>
        ))}
      </ul>
      <Link
        href="/sign-up"
        className={`block w-full rounded-lg py-3 text-center font-semibold ${
          highlighted 
            ? 'bg-white text-blue-600 hover:bg-blue-50' 
            : 'bg-blue-600 text-white hover:bg-blue-700'
        }`}
      >
          Get Started
      </Link>
    </div>
  );
}
