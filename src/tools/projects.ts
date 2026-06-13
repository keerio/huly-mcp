import tracker from '@hcengineering/tracker'
import core from '@hcengineering/core'
import task from '@hcengineering/task'
import { generateId, type Ref } from '@hcengineering/core'
import type { ProjectType } from '@hcengineering/task'
import { getConnection } from '../connection'
import { wrapToolHandler } from '../utils/errors'
import type { z } from 'zod'
import type { GetProjectSchema, CreateProjectSchema, ArchiveProjectSchema } from '../schemas'

export const listProjects = wrapToolHandler<Record<string, never>>(async () => {
  const client = await getConnection()
  const projects = await client.findAll(tracker.class.Project, {})

  if (projects.length === 0) return 'No projects found in this workspace.'

  const lines = projects.map((p) =>
    `- **${p.identifier}** — ${p.name ?? '(no name)'}${p.description != null && p.description !== '' ? `\n  ${p.description}` : ''}`
  )
  return `## Projects (${projects.length})\n\n${lines.join('\n')}`
})

export const getProject = wrapToolHandler<z.infer<typeof GetProjectSchema>>(async (args) => {
  const client = await getConnection()
  const project = await client.findOne(tracker.class.Project, { identifier: args.identifier })
  if (project == null) throw new Error(`Project '${args.identifier}' not found.`)

  const statuses = await client.findAll(tracker.class.IssueStatus, {})
  const statusList = statuses.map((s) => `  - ${s.name}`).join('\n')

  return [
    `## Project: ${project.identifier}`,
    `**Name:** ${project.name ?? '(no name)'}`,
    project.description != null && project.description !== '' ? `**Description:** ${project.description}` : null,
    `**Issues created:** ${project.sequence}`,
    `\n**Statuses:**\n${statusList}`
  ].filter(Boolean).join('\n')
})

export const createProject = wrapToolHandler<z.infer<typeof CreateProjectSchema>>(async (args) => {
  const client = await getConnection()

  // Check identifier is unique
  const existing = await client.findOne(tracker.class.Project, { identifier: args.identifier })
  if (existing != null) throw new Error(`A project with identifier '${args.identifier}' already exists.`)

  // Find the classic project type (used by Huly Tracker)
  const projectType = await client.findOne(task.class.ProjectType, {
    _id: tracker.ids.ClassingProjectType as unknown as Ref<ProjectType>
  }) ?? await client.findOne(task.class.ProjectType, {})
  if (projectType == null) throw new Error('Could not find a ProjectType. Ensure the Huly Tracker is set up.')

  const projectId = generateId()

  await client.createDoc(
    tracker.class.Project,
    core.space.Space,
    {
      name: args.name,
      description: args.description ?? '',
      identifier: args.identifier,
      sequence: 0,
      defaultAssignee: undefined,
      defaultTimeReportDay: 'CurrentWorkDay' as any,
      defaultIssueStatus: undefined as any,
      type: projectType._id,
      members: [client.user],
      archived: false,
      private: false
    } as any,
    projectId
  )

  return `✅ Project **${args.identifier}** ("${args.name}") created successfully.\nNote: default statuses are set up automatically by the platform.`
})

export const archiveProject = wrapToolHandler<z.infer<typeof ArchiveProjectSchema>>(async (args) => {
  const client = await getConnection()
  const project = await client.findOne(tracker.class.Project, { identifier: args.identifier })
  if (project == null) throw new Error(`Project '${args.identifier}' not found.`)
  if (project.archived) return `Project **${args.identifier}** ("${project.name}") is already archived.`

  await client.updateDoc(tracker.class.Project, core.space.Space, project._id, { archived: true })
  return `✅ Project **${args.identifier}** ("${project.name}") archived.\nIt is hidden from the sidebar and normal listings but fully preserved. Restore with unarchive_project (requires a MAINTAINER+/OWNER account) or via the Tracker UI archive view.`
})

export const unarchiveProject = wrapToolHandler<z.infer<typeof ArchiveProjectSchema>>(async (args) => {
  const client = await getConnection()
  // Archived projects (spaces) are visible only to accounts with role MAINTAINER or
  // OWNER — the transactor's space-security middleware hides them from regular USERs.
  const project = await client.findOne(tracker.class.Project, { identifier: args.identifier })
  if (project == null) {
    throw new Error(
      `Project '${args.identifier}' not found or not visible. Archived projects are only ` +
      `visible to MAINTAINER/OWNER accounts; this account may lack the role. ` +
      `Either connect with an elevated token or restore via the Tracker UI archive view.`
    )
  }
  if (!project.archived) return `Project **${args.identifier}** ("${project.name}") is not archived.`

  await client.updateDoc(tracker.class.Project, core.space.Space, project._id, { archived: false })
  return `✅ Project **${args.identifier}** ("${project.name}") restored from archive.`
})
