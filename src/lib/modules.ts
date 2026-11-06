import {
  BarChart3,
  BookOpen,
  CheckSquare,
  FileText,
  GraduationCap,
  IndianRupee,
  LayoutDashboard,
  MessageSquare,
  Settings,
  Users,
  type LucideIcon,
} from "lucide-react";

import type { Role } from "@/lib/roles";

export type ModuleId =
  | "dashboard"
  | "reports"
  | "leads"
  | "students"
  | "admissions"
  | "courses"
  | "tasks"
  | "communication"
  | "fees"
  | "settings";

export type ModuleDef = {
  id: ModuleId;
  label: string;
  href: string;
  icon: LucideIcon;
  description: string;
  section: string;
  roles: readonly Role[];
};

export const MODULES: readonly ModuleDef[] = [
  {
    id: "dashboard",
    label: "Dashboard",
    href: "/dashboard",
    icon: LayoutDashboard,
    description: "Key numbers, charts and today's follow-ups.",
    section: "Overview",
    roles: ["ADMIN", "COUNSELLOR", "ACCOUNTS", "VIEWER"],
  },
  {
    id: "reports",
    label: "Reports",
    href: "/reports",
    icon: BarChart3,
    description: "Conversion, counsellor performance and revenue by course.",
    section: "Overview",
    roles: ["ADMIN", "VIEWER"],
  },
  {
    id: "leads",
    label: "Leads",
    href: "/leads",
    icon: Users,
    description: "Capture enquiries and move them through the pipeline.",
    section: "Student journey",
    roles: ["ADMIN", "COUNSELLOR"],
  },
  {
    id: "students",
    label: "Students",
    href: "/students",
    icon: GraduationCap,
    description: "A complete view of every student and their history.",
    section: "Student journey",
    roles: ["ADMIN", "COUNSELLOR", "ACCOUNTS"],
  },
  {
    id: "admissions",
    label: "Admissions",
    href: "/admissions",
    icon: FileText,
    description: "Admissions, documents checklists and batch placement.",
    section: "Student journey",
    roles: ["ADMIN", "COUNSELLOR"],
  },
  {
    id: "courses",
    label: "Courses",
    href: "/courses",
    icon: BookOpen,
    description: "Courses, fees, batches and seat availability.",
    section: "Student journey",
    roles: ["ADMIN", "COUNSELLOR"],
  },
  {
    id: "tasks",
    label: "Tasks",
    href: "/tasks",
    icon: CheckSquare,
    description: "Follow-ups, reminders and a shared calendar.",
    section: "Operations",
    roles: ["ADMIN", "COUNSELLOR"],
  },
  {
    id: "communication",
    label: "Communication",
    href: "/communication",
    icon: MessageSquare,
    description: "Message templates and logged calls, emails and WhatsApp.",
    section: "Operations",
    roles: ["ADMIN", "COUNSELLOR"],
  },
  {
    id: "fees",
    label: "Fees",
    href: "/fees",
    icon: IndianRupee,
    description: "Fee plans, instalments, payments and GST receipts.",
    section: "Operations",
    roles: ["ADMIN", "ACCOUNTS"],
  },
  {
    id: "settings",
    label: "Settings",
    href: "/settings",
    icon: Settings,
    description: "Users, roles, pipeline stages, lead sources, branches and branding.",
    section: "Admin",
    roles: ["ADMIN"],
  },
];

export function getModule(id: string) {
  return MODULES.find((module) => module.id === id);
}

export function modulesForRole(role: Role) {
  return MODULES.filter((module) => module.roles.includes(role));
}
