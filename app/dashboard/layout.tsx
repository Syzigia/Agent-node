import { auth } from "@clerk/nextjs/server"
import { redirect } from "next/navigation"
import { UserButton } from "@clerk/nextjs"
import { isWhitelisted } from "@/lib/whitelist"

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const { userId } = await auth()
  if (!userId) redirect("/")
  if (!isWhitelisted(userId)) redirect("/waitlist")

  return (
    <div className="min-h-svh">
      <header className="flex h-12 items-center justify-between border-b px-4">
        <a href="/dashboard" className="text-sm font-medium">
          Mastra AI
        </a>
        <UserButton />
      </header>
      <main className="mx-auto w-full max-w-6xl px-3 py-4 sm:px-6 sm:py-6">
        {children}
      </main>
    </div>
  )
}
