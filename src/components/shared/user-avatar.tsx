import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { initials } from "@/lib/format";

export function UserAvatar({ name, size }: { name: string; size?: "default" | "sm" | "lg" }) {
  return (
    <Avatar size={size}>
      <AvatarFallback className="bg-primary-soft text-xs font-medium text-primary-soft-foreground">
        {initials(name)}
      </AvatarFallback>
    </Avatar>
  );
}
