"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { Eye, EyeOff, Loader2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { loginSchema, type LoginInput } from "@/lib/validations/auth";
import { login } from "@/server/actions/auth";

type DemoAccounts = { password: string; users: { email: string; role: string }[] };

export function LoginForm({
  callbackUrl,
  demoAccounts,
}: {
  callbackUrl: string;
  demoAccounts?: DemoAccounts;
}) {
  const router = useRouter();
  const [showPassword, setShowPassword] = useState(false);
  const {
    register,
    handleSubmit,
    setValue,
    formState: { errors, isSubmitting },
  } = useForm<LoginInput>({
    resolver: zodResolver(loginSchema),
    defaultValues: { email: "", password: "" },
  });

  async function onSubmit(values: LoginInput) {
    try {
      const result = await login(values);
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success("Signed in");
      router.replace(callbackUrl);
      router.refresh();
    } catch {
      toast.error("Couldn't sign you in. Please try again.");
    }
  }

  return (
    <>
      <form onSubmit={handleSubmit(onSubmit)} noValidate className="space-y-4">
        <div className="space-y-1.5">
          <Label htmlFor="email">Email</Label>
          <Input
            id="email"
            type="email"
            autoComplete="email"
            className="h-10"
            aria-invalid={Boolean(errors.email)}
            aria-describedby={errors.email ? "email-error" : undefined}
            {...register("email")}
          />
          {errors.email && (
            <p id="email-error" className="text-xs text-destructive">
              {errors.email.message}
            </p>
          )}
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="password">Password</Label>
          <div className="relative">
            <Input
              id="password"
              type={showPassword ? "text" : "password"}
              autoComplete="current-password"
              className="h-10 pr-10"
              aria-invalid={Boolean(errors.password)}
              aria-describedby={errors.password ? "password-error" : undefined}
              {...register("password")}
            />
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="absolute top-1 right-1 text-muted-foreground"
              aria-label={showPassword ? "Hide password" : "Show password"}
              aria-pressed={showPassword}
              onClick={() => setShowPassword((shown) => !shown)}
            >
              {showPassword ? <EyeOff /> : <Eye />}
            </Button>
          </div>
          {errors.password && (
            <p id="password-error" className="text-xs text-destructive">
              {errors.password.message}
            </p>
          )}
        </div>

        <Button type="submit" className="h-10 w-full" disabled={isSubmitting}>
          {isSubmitting && <Loader2 className="animate-spin" aria-hidden />}
          {isSubmitting ? "Signing in..." : "Sign in"}
        </Button>
      </form>

      {demoAccounts && (
        <div className="mt-6 rounded-xl border border-dashed p-3">
          <p className="mb-2 text-xs text-muted-foreground">
            Development only. Choose a demo account to fill in the form:
          </p>
          <div className="flex flex-wrap gap-1.5">
            {demoAccounts.users.map(({ email, role }) => (
              <Button
                key={email}
                type="button"
                variant="outline"
                size="sm"
                onClick={() => {
                  setValue("email", email, { shouldValidate: true });
                  setValue("password", demoAccounts.password, { shouldValidate: true });
                }}
              >
                {role}
              </Button>
            ))}
          </div>
        </div>
      )}
    </>
  );
}
