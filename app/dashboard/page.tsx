"use client"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Plus, FolderOpen, Trash2 } from "lucide-react"

type Project = {
  id: string
  name: string
  createdAt: string
}

export default function DashboardPage() {
  const router = useRouter()
  const [projects, setProjects] = useState<Project[]>([])
  const [loading, setLoading] = useState(true)
  const [creating, setCreating] = useState(false)
  const [newName, setNewName] = useState("")

  async function fetchProjects() {
    const res = await fetch("/api/projects")
    if (res.ok) setProjects(await res.json())
    setLoading(false)
  }

  useEffect(() => {
    fetchProjects()
  }, [])

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault()
    if (!newName.trim()) return
    setCreating(true)
    const res = await fetch("/api/projects", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: newName.trim() }),
    })
    if (res.ok) {
      const project = await res.json()
      setNewName("")
      router.push(`/dashboard/${project.id}`)
    }
    setCreating(false)
  }

  async function handleDelete(e: React.MouseEvent, projectId: string) {
    e.stopPropagation()
    if (!confirm("Delete this project?")) return
    await fetch(`/api/projects/${projectId}`, { method: "DELETE" })
    setProjects((prev) => prev.filter((p) => p.id !== projectId))
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-lg font-medium">Projects</h1>
        <p className="text-sm text-muted-foreground">
          Select a project or create a new one.
        </p>
      </div>

      <form onSubmit={handleCreate} className="flex flex-col gap-2 sm:flex-row">
        <Input
          placeholder="New project name..."
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          className="max-w-full sm:max-w-xs"
        />
        <Button type="submit" disabled={creating || !newName.trim()}>
          <Plus className="size-4" />
          Create
        </Button>
      </form>

      {loading ? (
        <p className="text-sm text-muted-foreground">Loading...</p>
      ) : projects.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No projects yet. Create your first one above.
        </p>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          {projects.map((project) => (
            <Card
              key={project.id}
              className="flex cursor-pointer items-center justify-between p-4 transition-colors hover:bg-muted/50"
              onClick={() => router.push(`/dashboard/${project.id}`)}
            >
              <div className="flex items-center gap-3">
                <FolderOpen className="size-4 text-muted-foreground" />
                <div>
                  <p className="text-sm font-medium">{project.name}</p>
                  <p className="text-xs text-muted-foreground">
                    {new Date(project.createdAt).toLocaleDateString()}
                  </p>
                </div>
              </div>
              <Button
                variant="ghost"
                size="icon-xs"
                onClick={(e) => handleDelete(e, project.id)}
              >
                <Trash2 className="size-3.5" />
              </Button>
            </Card>
          ))}
        </div>
      )}
    </div>
  )
}
