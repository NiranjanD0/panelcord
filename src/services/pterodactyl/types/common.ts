import type { PterodactylApiErrorDetail } from "../errors/base.js";

export interface PterodactylClientConfig {
  baseUrl: string;
  apiKey: string;
  timeoutMs?: number;
}

export type HttpMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

export interface RequestOptions {
  query?: Record<string, string | number | boolean | undefined | null>;
  body?: unknown;
  headers?: Record<string, string>;
  timeoutMs?: number;
}

export interface PterodactylPaginationLinks {
  next?: string | null;
  previous?: string | null;
}

export interface PterodactylPagination {
  total: number;
  count: number;
  per_page: number;
  current_page: number;
  total_pages: number;
  links?: PterodactylPaginationLinks;
}

export interface PterodactylMeta {
  pagination?: PterodactylPagination;
  [key: string]: unknown;
}

export interface PterodactylFractalItem<T> {
  object: string;
  attributes: T;
}

export interface PterodactylFractalList<T> {
  object: "list";
  data: PterodactylFractalItem<T>[];
  meta?: PterodactylMeta;
}

export interface PterodactylErrorResponse {
  errors: PterodactylApiErrorDetail[];
}
