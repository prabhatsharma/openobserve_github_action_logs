import * as github from '@actions/github'
import axios, {AxiosResponse} from 'axios'
import * as core from '@actions/core'
import { group } from 'console'

export type Log = {
  job_id: number
  run_id: number
  _timestamp?: number
  log: string | null
}

enum GroupIndicators {
  Begin = 1,
  End,
  Noop
}

const getLineGroupIndicator = (line: string): GroupIndicators => {
  const msg = line.slice(29)
  if (msg.match(/^##\[group\]/)) {
    return GroupIndicators.Begin
  }
  if (msg.match(/^##\[[a-zA-Z0-9]+\]/)) {
    return GroupIndicators.End
  }
  return GroupIndicators.Noop
}

const parseTimestamp = (line: string): number | null => {
  const d = new Date(line.slice(0, 28))
  if (d instanceof Date && !isNaN(d.getTime())) {
    return d.getTime()
  }
  // Invalid date
  return null
}

// Read in a log file and parse it into a JSON object
// Log file will be in the format: [timestamp] [message] \n
export const parseLog1 = (
  job: {id: number; run_id: number},
  logs: string
): Log[] => {
  const lines = logs.split('\n')
  let groupIdx = 0
  const group: Log[] = []
  for (const line of lines) {
    if (line.trim().length === 0) {
      continue
    }
    const groupIndicator = getLineGroupIndicator(line)
    if (groupIndicator === GroupIndicators.Begin) {
      if (group[groupIdx]) {
        // Only advance to next group if there's a current group
        groupIdx = groupIdx + 1
      }
    }

    // Create the group log holder
    if (!group[groupIdx]) {
      const logItem: Log = {
        run_id: job.run_id,
        job_id: job.id,
        log: line
      }
      const timestamp = parseTimestamp(line)
      if (timestamp) logItem._timestamp = timestamp
      group[groupIdx] = logItem
    } else {
      group[groupIdx].log = `${group[groupIdx].log}\n${line}`
    }

    // AFTER the ending indicator, start a new group (keep the current line in the current group)
    if (groupIndicator === GroupIndicators.End) {
      groupIdx = groupIdx + 1
    }
  }

  return group
}

export const parseLog = (
  job: { id: number; run_id: number },
  logs: string
) => {
  let log1 = parseLog1(job, logs)
  let log2 = parseLog2(log1)
  return log2
}

export const parseLog2 = (group: Log[]): Log[] => {
  // get the group from parseLog function. parse each group and split it by "\n" to get additional lines in log
  // then parse each line and get the timestamp and message
  // then create a new array of logs with the timestamp and message
  const logs: Log[] = []
  for (const g of group) {
    if (g.log !== null) {
      const lines = g.log.split('\n')
      for (const line of lines) {
        const logItem: Log = {
          run_id: g.run_id,
          job_id: g.job_id,
          log: line
        }
        const timestamp = parseTimestamp(line)
        if (timestamp) logItem._timestamp = timestamp
        logs.push(logItem)
      }
    }
  }

  return logs
}

export const fetchRunLogs = async (
  githubToken: string,
  githubOwner: string,
  githubRepo: string,
  githubRunId: string
): Promise<Log[]> => {
  const octokit = github.getOctokit(githubToken)

  const jobRequest = await octokit.rest.actions.listJobsForWorkflowRun({
    owner: githubOwner,
    repo: githubRepo,
    run_id: parseInt(githubRunId, 10)
  })
  const jobs = jobRequest.data.jobs
  const jobsDone = jobs.filter(job => job.status === 'completed')
  let logs: Log[] = []
  for (const job of jobsDone) {
    const response = await octokit.rest.actions.downloadJobLogsForWorkflowRun({
      owner: githubOwner,
      repo: githubRepo,
      job_id: job.id
    })
    logs = logs.concat(parseLog(job, response.data as string))
  }
  return logs
}

type OpenObserveResult = {
  code: number
  status: {
    name: string
    successful: number
    failed: number
  }[]
}

export const uploadLogs = async (
  endpoint: string,
  username: string,
  key: string,
  logs: Log[]
): Promise<AxiosResponse<OpenObserveResult>> => {
  console.log('Uploading logs to Open Observe:', endpoint)
  core.debug('This is a debug message')
  return axios.post(endpoint, logs, {
    auth: {username, password: key},
    headers: {'Content-Type': 'application/json'}
  })
}
