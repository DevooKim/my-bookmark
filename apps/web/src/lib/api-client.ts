import { type MeResponse, meResponseSchema } from "@my-bookmark/shared";
import { supabase } from "./supabase";

const apiUrl = import.meta.env.VITE_API_URL ?? "http://localhost:3001";

async function getAccessToken() {
  const { data, error } = await supabase.auth.getSession();
  if (error) {
    throw error;
  }
  return data.session?.access_token;
}

async function refreshAccessToken() {
  const { data, error } = await supabase.auth.refreshSession();
  if (error) {
    throw error;
  }
  return data.session?.access_token;
}

async function apiFetch(path: string, init: RequestInit = {}, retry = true) {
  const token = await getAccessToken();
  const headers = new Headers(init.headers);
  headers.set("Accept", "application/json");

  if (init.body && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }

  if (token) {
    headers.set("Authorization", `Bearer ${token}`);
  }

  const response = await fetch(`${apiUrl}${path}`, { ...init, headers });

  if (response.status === 401 && retry) {
    const refreshedToken = await refreshAccessToken();
    if (refreshedToken) {
      headers.set("Authorization", `Bearer ${refreshedToken}`);
      return fetch(`${apiUrl}${path}`, { ...init, headers });
    }
  }

  return response;
}

export async function getMe(): Promise<MeResponse> {
  const response = await apiFetch("/api/me");

  if (!response.ok) {
    throw new Error("Failed to load current user");
  }

  return meResponseSchema.parse(await response.json());
}
