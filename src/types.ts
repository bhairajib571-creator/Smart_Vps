export interface BotFile {
  name: string;
  type: string;
  size: string;
  isRunning?: boolean;
}

export interface BotStatus {
  isLocked: boolean;
  activeBots: number;
  totalUsers: number;
  totalFiles: number;
}
