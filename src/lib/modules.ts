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
  | "applications"
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
  /** The build phase that delivers this module. */
  phase: number;
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
    phase: 7,
    roles: ["ADMIN", "COUNSELLOR", "ACCOUNTS", "VIEWER"],
  },
  {
    id: "reports",
    label: "Reports",
    href: "/reports",
    icon: BarChart3,
    description: "Conversion, counsellor performance and revenue by course.",
    section: "Overview",
    phase: 7,
    roles: ["ADMIN", "VIEWER"],
  },
  {
    id: "leads",
    label: "Leads",
    href: "/leads",
    icon: Users,
    description: "Capture enquiries and move them through the pipeline.",
    section: "Student journey",
    phase: 3,
    roles: ["ADMIN", "COUNSELLOR"],
  },
  {
    id: "students",
    label: "Students",
    href: "/students",
    icon: GraduationCap,
    description: "A complete view of every student and their history.",
    section: "Student journey",
    phase: 4,
    roles: ["ADMIN", "COUNSELLOR", "ACCOUNTS"],
  },
  {
    id: "applications",
    label: "Applications",
    href: "/applications",
    icon: FileText,
    description: "Track applications, admissions and required documents.",
    section: "Student journey",
    phase: 6,
    roles: ["ADMIN", "COUNSELLOR"],
  },
  {
    id: "courses",
    label: "Courses",
    href: "/courses",
    icon: BookOpen,
    description: "Courses, fees, batches and seat availability.",
    section: "Student journey",
    phase: 6,
    roles: ["ADMIN", "COUNSELLOR"],
  },
  {
    id: "tasks",
    label: "Tasks",
    href: "/tasks",
    icon: CheckSquare,
    description: "Follow-ups, reminders and a shared calendar.",
    section: "Operations",
    phase: 5,
    roles: ["ADMIN", "COUNSELLOR"],
  },
  {
    id: "communication",
    label: "Communication",
    href: "/communication",
    icon: MessageSquare,
    description: "Message templates and logged calls, emails and WhatsApp.",
    section: "Operations",
    phase: 8,
    roles: ["ADMIN", "COUNSELLOR"],
  },
  {
    id: "fees",
    label: "Fees",
    href: "/fees",
    icon: IndianRupee,
    description: "Fee plans, instalments, payments and GST receipts.",
    section: "Operations",
    phase: 6,
    roles: ["ADMIN", "ACCOUNTS"],
  },
  {
    id: "settings",
    label: "Settings",
    href: "/settings",
    icon: Settings,
    description: "Users, roles, pipeline stages, lead sources, target exams and branding.",
    section: "Admin",
    phase: 8,
    roles: ["ADMIN"],
  },
];

export function getModule(id: string) {
  return MODULES.find((module) => module.id === id);
}

export function modulesForRole(role: Role) {
  return MODULES.filter((module) => module.roles.includes(role));
}
