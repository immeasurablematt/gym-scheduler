import { auth } from "@clerk/nextjs/server";
import Link from "next/link";
import { redirect } from "next/navigation";
import { hasClerkServerKeys } from "@/lib/auth";
import { getTrainerDashboardData } from "@/lib/sessions";
import { format } from "date-fns";
import { Calendar, Users, DollarSign, TrendingUp, Clock, AlertCircle } from "lucide-react";

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  if (hasClerkServerKeys) {
    const { userId } = await auth();

    if (!userId) {
      redirect("/sign-in");
    }
  }

  const dashboardData = await getTrainerDashboardData();
  const stats = dashboardData.stats;
  const upcomingSessions = dashboardData.upcomingSessions;
  const recentActivity = dashboardData.recentActivity;

  return (
    <div className="space-y-6">
      {!hasClerkServerKeys && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          Clerk keys are not configured locally, so the dashboard is running in
          preview mode without authentication.
        </div>
      )}
      <div>
        <h1 className="text-3xl font-bold text-gray-900">Dashboard</h1>
        <p className="mt-1 text-gray-600">
          {!dashboardData.isConfigured
            ? dashboardData.setupIssue ?? "Supabase needs a little more setup before live data can load."
            : dashboardData.trainerName
            ? `Welcome back, ${dashboardData.trainerName}. Here's your live scheduling overview.`
            : "Connect a trainer profile in Supabase to start seeing live scheduling data."}
        </p>
      </div>

      {/* Stats Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        <StatCard
          title="Today's Sessions"
          value={stats.todaySessions}
          icon={<Calendar className="h-6 w-6 text-blue-600" />}
          trend="Scheduled for today"
        />
        <StatCard
          title="Weekly Revenue"
          value={`$${stats.weeklyRevenue}`}
          icon={<DollarSign className="h-6 w-6 text-green-600" />}
          trend="Estimated from completed sessions this week"
        />
        <StatCard
          title="Active Clients"
          value={stats.activeClients}
          icon={<Users className="h-6 w-6 text-purple-600" />}
          trend="Clients with non-cancelled sessions"
        />
        <StatCard
          title="Completion Rate"
          value={`${stats.completionRate}%`}
          icon={<TrendingUp className="h-6 w-6 text-orange-600" />}
          trend="Completed sessions this week"
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Upcoming Sessions */}
        <div className="bg-white rounded-lg shadow-sm border border-gray-200">
          <div className="p-6 border-b border-gray-200">
            <h2 className="text-lg font-semibold text-gray-900 flex items-center">
              <Clock className="h-5 w-5 mr-2 text-gray-600" />
              Upcoming Sessions
            </h2>
          </div>
          <div className="p-6">
            {upcomingSessions.length === 0 ? (
              <p className="text-sm text-gray-600">
                No scheduled sessions yet. Add one from the schedule page to
                start building the calendar.
              </p>
            ) : (
              <div className="space-y-4">
                {upcomingSessions.map((session) => (
                  <div key={session.id} className="flex justify-between items-center p-3 bg-gray-50 rounded-lg">
                    <div>
                      <p className="font-medium text-gray-900">{session.clientName}</p>
                      <p className="text-sm text-gray-600">{session.sessionType}</p>
                    </div>
                    <span className="text-sm font-medium text-blue-600">
                      {format(new Date(session.scheduledAt), "h:mm a")}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Recent Activity */}
        <div className="bg-white rounded-lg shadow-sm border border-gray-200">
          <div className="p-6 border-b border-gray-200">
            <h2 className="text-lg font-semibold text-gray-900 flex items-center">
              <AlertCircle className="h-5 w-5 mr-2 text-gray-600" />
              Recent Activity
            </h2>
          </div>
          <div className="p-6">
            {recentActivity.length === 0 ? (
              <p className="text-sm text-gray-600">
                Session changes will appear here after the first live update.
              </p>
            ) : (
              <div className="space-y-4">
                {recentActivity.map((activity) => (
                  <div key={activity.id} className="flex justify-between items-start gap-4">
                    <div>
                      <p className="font-medium text-gray-900">{activity.action}</p>
                      <p className="text-sm text-gray-600">{activity.detail}</p>
                    </div>
                    <span className="text-sm text-gray-500">{activity.time}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Quick Actions */}
      <div className="bg-blue-50 rounded-lg p-6">
        <h3 className="text-lg font-semibold text-gray-900 mb-4">Quick Actions</h3>
        <div className="flex flex-wrap gap-3">
          <Link
            href="/dashboard/schedule"
            className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 font-medium"
          >
            Manage Schedule
          </Link>
          <button className="px-4 py-2 bg-white text-gray-700 rounded-lg hover:bg-gray-50 font-medium border border-gray-300">
            Add Client
          </button>
          <button className="px-4 py-2 bg-white text-gray-700 rounded-lg hover:bg-gray-50 font-medium border border-gray-300">
            View Calendar
          </button>
          <button className="px-4 py-2 bg-white text-gray-700 rounded-lg hover:bg-gray-50 font-medium border border-gray-300">
            Generate Report
          </button>
        </div>
      </div>
    </div>
  );
}

function StatCard({ 
  title, 
  value, 
  icon, 
  trend 
}: { 
  title: string; 
  value: string | number; 
  icon: React.ReactNode; 
  trend: string;
}) {
  return (
    <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
      <div className="flex items-center justify-between mb-4">
        <span className="text-sm font-medium text-gray-600">{title}</span>
        {icon}
      </div>
      <div className="text-2xl font-bold text-gray-900">{value}</div>
      <p className="text-sm text-gray-600 mt-1">{trend}</p>
    </div>
  );
}
