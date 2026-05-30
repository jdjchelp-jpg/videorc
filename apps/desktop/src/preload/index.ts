import { contextBridge, ipcRenderer } from 'electron'

import type { BackendConnection, BackendLogEvent, VideorcApi } from '../shared/backend'

const api: VideorcApi = {
  getBackendConnection: () => ipcRenderer.invoke('backend:get-connection'),
  getBackendLogs: () => ipcRenderer.invoke('backend:get-logs'),
  onBackendConnection: (callback) => {
    const listener = (_event: Electron.IpcRendererEvent, connection: BackendConnection): void => {
      callback(connection)
    }
    ipcRenderer.on('backend:connection', listener)
    return () => ipcRenderer.removeListener('backend:connection', listener)
  },
  onBackendLog: (callback) => {
    const listener = (_event: Electron.IpcRendererEvent, log: BackendLogEvent): void => {
      callback(log)
    }
    ipcRenderer.on('backend:log', listener)
    return () => ipcRenderer.removeListener('backend:log', listener)
  }
}

contextBridge.exposeInMainWorld('videorc', api)
