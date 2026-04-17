import { UserButton } from "@clerk/nextjs";
import Link from "next/link";
import { hasClerkPublishableKey } from "@/lib/auth";
import { Calendar, Users, CreditCard, BarChart3, Settings, Home, Dumbbell } from "lucide-react";

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-screen bg-gray-50">
      {/* Top Navigation */}
      <nav className="bg-white border-b border-gray-200 px-6 py-4">
        <div className="flex justify-between items-center">
          <div className="flex items-center space-x-8">
            <Link href="/dashboard" className="flex items-center space-x-2">
              <Dumbbell className="h-8 w-8 text-blue-600" />
              <span className="text-xl font-bold text-gray-900">GymScheduler</span>
            </Link>
          </div>
          <div className="flex items-center space-x-4">
            {hasClerkPublishableKey ? (
              <UserButton afterSignOutUrl="/" />
            ) : (
              <span className="rounded-full bg-slate-100 px-3 py-1 text-sm font-medium text-slate-600">
                Local preview
              </span>
            )}
          </div>
        </div>
      </nav>

      <div className="flex">
        {/* Sidebar */}
        <aside className="w-64 bg-white border-r border-gray-200 min-h-[calc(100vh-73px)]">
          <nav className="p-4 space-y-1">
            <SidebarLink href="/dashboard" icon={<Home />} label="Dashboard" />
            <SidebarLink href="/dashboard/schedule" icon={<Calendar />} label="Schedule" />
            <SidebarLink href="/dashboard/clients" icon={<Users />} label="Clients" />
            <SidebarLink href="/dashboard/payments" icon={<CreditCard />} label="Payments" />
            <SidebarLink href="/dashboard/analytics" icon={<BarChart3 />} label="Analytics" />
            <SidebarLink href="/dashboard/gym-view" icon={<Dumbbell />} label="Gym View" />
            <SidebarLink href="/dashboard/settings" icon={<Settings />} label="Settings" />
          </nav>
        </aside>

        {/* Main Content */}
        <main className="flex-1 p-6">
          {children}
        </main>
      </div>
    </div>
  );
}

function SidebarLink({ href, icon, label }: { href: string; icon: React.ReactNode; label: string }) {
  return (
    <Link
      href={href}
      className="flex items-center space-x-3 px-3 py-2 rounded-lg hover:bg-gray-100 text-gray-700 hover:text-gray-900 transition-colors"
    >
      <span className="w-5 h-5">{icon}</span>
      <span className="font-medium">{label}</span>
    </Link>
  );
}
