import type { Metadata } from "next";
import { ClerkProvider } from "@clerk/nextjs";
import { hasClerkPublishableKey } from "@/lib/auth";
import "./globals.css";

export const metadata: Metadata = {
  title: "Gym Scheduler - Personal Training Management",
  description: "Manage gym sessions, trainers, and clients efficiently",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const content = (
    <html lang="en">
      <body className="antialiased">{children}</body>
    </html>
  );

  if (!hasClerkPublishableKey) {
    return content;
  }

  return <ClerkProvider>{content}</ClerkProvider>;
}
