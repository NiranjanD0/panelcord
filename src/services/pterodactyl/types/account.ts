export interface PterodactylAccountAttributes {
  id: number;
  admin: boolean;
  username: string;
  email: string;
  first_name: string;
  last_name: string;
  language: string;
  [key: string]: unknown;
}
