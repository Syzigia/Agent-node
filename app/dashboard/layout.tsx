import { auth } from "@clerk/nextjs/server"
import { redirect } from "next/navigation"
import { UserButton } from "@clerk/nextjs"

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const { userId } = await auth()
  if (!userId) redirect("/")

  return (
    <div className="min-h-svh">
      <header className="flex h-12 items-center justify-between border-b px-4">
        <a href="/dashboard" className="text-sm font-medium">
          Mastra AI
        </a>
        <UserButton />
      </header>
      <main className="mx-auto max-w-4xl p-6">{children}</main>
    </div>
  )
}
