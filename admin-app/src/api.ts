import { invoke } from "@tauri-apps/api/core";

export interface Stats {
  users_total: number;
  premium_count: number;
  online_count: number;
  online_users: Array<{ xuid: string; player_name: string | null }>;
  news_count: number;
  generated_at: string;
}

export interface NewsItem {
  id: string;
  title: string;
  body: string;
  link: string;
  created_at: string;
}

export const stats = (): Promise<Stats> => invoke("admin_stats");
export const grant = (xuid: string, tier: string, days: number): Promise<{ ok: boolean }> =>
  invoke("admin_grant", { xuid, tier, days });
export const newsList = (): Promise<NewsItem[]> => invoke("admin_news_list");
export const newsPost = (title: string, body: string, link: string): Promise<{ ok: boolean }> =>
  invoke("admin_news_post", { title, body, link });
export const newsDelete = (id: string): Promise<{ ok: boolean }> =>
  invoke("admin_news_delete", { id });
