import { auth } from "@clerk/nextjs/server"
import { redirect } from "next/navigation"
import { isWhitelisted } from "@/lib/whitelist"
import WaitlistPage from "@/components/landing/WaitlistPage"

export const metadata = {
  title: "TON — Waitlist",
  description: "You're in orbit. Access is coming.",
}

export default async function Page() {
  const { userId } = await auth()

  // Not logged in → send to landing
  if (!userId) redirect("/")

  // Already whitelisted → send to dashboard
  if (isWhitelisted(userId)) redirect("/dashboard")

  return <WaitlistPage />
}
