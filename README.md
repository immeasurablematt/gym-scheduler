# GymScheduler - Personal Training Management System

A comprehensive gym scheduling application for managing personal trainers and their clients, built with Next.js, Supabase, Clerk, and Stripe.

## Features

- **Smart Scheduling**: AI-powered scheduling with conflict detection
- **Multi-trainer Support**: Manage up to 4 trainers with 10 clients each
- **Payment Processing**: Integrated Stripe payments
- **3D Gym Visualization**: Interactive Three.js gym space view
- **Real-time Updates**: Instant notifications for schedule changes
- **Role-based Access**: Separate interfaces for trainers and clients

## Tech Stack

- **Framework**: Next.js 14 with App Router
- **Database**: Supabase (PostgreSQL)
- **Authentication**: Clerk
- **Payments**: Stripe
- **Styling**: Tailwind CSS
- **3D Graphics**: Three.js
- **AI Integration**: Claude (Anthropic) & GPT-5 (OpenAI)
- **Email**: Resend

## Setup Instructions

1. **Clone and install dependencies**:
```bash
cd gym-scheduler
npm install
```

2. **Set up environment variables**:
   - Copy `.env.local.example` to `.env.local`
   - Fill in your API keys from:
     - [Supabase](https://supabase.com)
     - [Clerk](https://clerk.com)
     - [Stripe](https://stripe.com)
     - [Resend](https://resend.com)
     - [Google Calendar](https://calendar.google.com)
     - [Anthropic](https://anthropic.com)
     - [OpenAI](https://openai.com)

3. **Set up Supabase database**:
   - Create a new Supabase project
   - Run the SQL schema from `supabase/schema.sql`
   - Update `.env.local` with your Supabase credentials

4. **Configure Clerk**:
   - Create a Clerk application
   - Set up sign-in/sign-up URLs in Clerk dashboard
   - Add your Clerk keys to `.env.local`

5. **Run the development server**:
```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) to view the application.

## Project Structure

```
gym-scheduler/
├── app/                    # Next.js app router pages
│   ├── dashboard/         # Protected dashboard routes
│   ├── sign-in/          # Authentication pages
│   └── api/              # API routes
├── components/            # React components
│   ├── ui/               # UI components
│   ├── scheduling/       # Scheduling components
│   └── dashboard/        # Dashboard components
├── lib/                   # Utility functions and configs
│   └── supabase/         # Supabase client
├── types/                # TypeScript type definitions
├── hooks/                # Custom React hooks
└── supabase/            # Database schema and migrations
```

## Key Features Implementation Status

- ✅ Next.js setup with TypeScript and Tailwind
- ✅ Project structure and dependencies
- ✅ Supabase database schema
- ✅ Clerk authentication setup
- ✅ Landing page with pricing
- ✅ Dashboard layout and main page
- ⏳ Scheduling system with conflict detection
- ⏳ Session booking and management
- ⏳ Stripe payment integration
- ⏳ Email notifications with Resend
- ⏳ 3D gym visualization
- ⏳ AI scheduling optimization
- ⏳ Client and trainer dashboards

## Development Commands

```bash
npm run dev      # Start development server
npm run build    # Build for production
npm run start    # Start production server
npm run lint     # Run ESLint
npm run typecheck # Run TypeScript without emitting files
npm test         # Run Node-based script tests
npm run check    # Run lint, typecheck, tests, and build
npm run bug-sweep:dry-run # Inspect repo health without mutating git
npm run bug-sweep # Run the safe overnight bug sweep
```

## Overnight Bug Sweep

This repo includes a conservative overnight bug-sweep command for unattended runs.

- `npm run bug-sweep:dry-run` checks the repo and writes a report without creating a branch or changing code.
- `npm run bug-sweep` runs the same checks, creates a fresh `codex/overnight-bug-sweep-*` branch only when safe auto-fixes are available, and commits those low-risk fixes there.
- Reports are written to `reports/bug-sweeps/`.

The first version only auto-fixes lint issues. Higher-risk failures are reported for review instead of being rewritten automatically.

## SMS And Calendar Runtime

- SMS automation enters at `POST /api/twilio/inbound`
- Google Calendar OAuth starts at `GET /api/google/calendar/connect`
- Session calendar retry processing runs through `POST /api/internal/calendar-sync`
- `sessions` remains the booking source of truth
- `trainer_calendar_connections` stores per-trainer Google OAuth and calendar metadata
- `calendar_sync_jobs` stores retryable Google session sync work
- `sms_conversations` stores lightweight pending SMS state for cancel/reschedule turns

## Database Schema

The application uses a PostgreSQL database (via Supabase) with the following main tables:
- `users` - User authentication data
- `trainers` - Trainer profiles and settings
- `clients` - Client profiles and assignments
- `sessions` - Training sessions and schedules
- `trainer_calendar_connections` - Google Calendar OAuth and sync metadata
- `calendar_sync_jobs` - queued session calendar sync retries
- `sms_conversations` - lightweight pending SMS intent state
- `payments` - Payment records
- `gym_spaces` - Gym area management
- `notifications_preferences` - User notification settings

## License

MIT
