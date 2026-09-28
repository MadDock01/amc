export type Plan = "trial" | "basic" | "pro" | "enterprise";
export type SubscriptionStatus = "active" | "expired" | "cancelled";
export type Role = "owner" | "staff" | "super_admin";
export type ReminderType = "warranty" | "amc";
export type ReminderStatus = "pending" | "sent" | "failed" | "cancelled";
export type Channel = "sms" | "email" | "whatsapp";

export interface Tenant {
  id: string;
  business_name: string;
  business_type: string | null;
  phone: string | null;
  address: string | null;
  subscription_plan: Plan;
  subscription_status: SubscriptionStatus;
  trial_ends_at: string;
  subscription_ends_at: string | null;
  reminder_days: number[];
  notify_owner_sms: boolean;
  notify_owner_email: boolean;
  sms_language: "en" | "bn";
  renewal_notice_for: string | null;
  created_at: string;
}

export interface AppUser {
  id: string;
  tenant_id: string | null;
  email: string | null;
  phone: string | null;
  role: Role;
  name: string | null;
  created_at: string;
  last_login: string | null;
}

export interface Customer {
  id: string;
  tenant_id: string;
  name: string;
  phone: string | null;
  email: string | null;
  address: string | null;
  created_at: string;
}

export interface Product {
  id: string;
  tenant_id: string;
  customer_id: string;
  product_name: string;
  category: string | null;
  serial_number: string | null;
  purchase_date: string;
  warranty_months: number;
  warranty_expiry_date: string | null;
  amc_start_date: string | null;
  amc_months: number | null;
  amc_expiry_date: string | null;
  is_active: boolean;
  public_token: string;
  notes: string | null;
  created_at: string;
}

export type ProductWithCustomer = Product & { customers: Pick<Customer, "id" | "name" | "phone" | "email"> | null };

export interface Reminder {
  id: string;
  tenant_id: string;
  product_id: string;
  reminder_type: ReminderType;
  days_before: number;
  expiry_date: string;
  scheduled_date: string;
  status: ReminderStatus;
  channel: Channel;
  attempts: number;
  next_attempt_at: string;
  last_error: string | null;
  sent_at: string | null;
  created_at: string;
}

export interface NotificationLog {
  id: string;
  tenant_id: string | null;
  reminder_id: string | null;
  kind: string;
  channel: Channel;
  recipient_phone: string | null;
  recipient_email: string | null;
  message_content: string;
  status: "sent" | "failed";
  provider_response: string | null;
  sms_segments: number;
  cost: number;
  sent_at: string;
}

export interface Subscription {
  id: string;
  tenant_id: string;
  plan: Plan;
  amount: number;
  billing_cycle: "monthly" | "yearly";
  starts_at: string | null;
  ends_at: string | null;
  payment_ref: string | null;
  provider_trx_id: string | null;
  status: "pending" | "active" | "failed" | "cancelled" | "expired";
  created_at: string;
}
