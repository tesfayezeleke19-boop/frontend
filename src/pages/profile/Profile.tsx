
import { useEffect, useState, type FormEvent } from "react";
import {
  Mail,
  LockKeyhole,
  UserRound,
  ShieldCheck,
  Loader2,
  Save,
} from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

import {
  getProfile,
  updateProfileEmail,
  updateProfilePassword,
  type ProfileUser,
} from "@/pages/profile/profileApi";

export default function Profile() {
  const [profile, setProfile] = useState<ProfileUser | null>(null);
  const [loading, setLoading] = useState(true);

  const [email, setEmail] = useState("");
  const [savingEmail, setSavingEmail] = useState(false);

  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [savingPassword, setSavingPassword] = useState(false);

  useEffect(() => {
    let mounted = true;

    const loadProfile = async () => {
      try {
        const result = await getProfile();

        if (mounted) {
          setProfile(result);
          setEmail(result.email);
        }
      } catch (error: unknown) {
        if (mounted) {
          toast.error(
            error instanceof Error
              ? error.message
              : "Unable to load your profile.",
          );
        }
      } finally {
        if (mounted) {
          setLoading(false);
        }
      }
    };

    void loadProfile();

    return () => {
      mounted = false;
    };
  }, []);

  const handleEmailUpdate = async (
    event: FormEvent<HTMLFormElement>,
  ) => {
    event.preventDefault();

    const normalizedEmail = email.trim().toLowerCase();

    if (!normalizedEmail) {
      toast.error("Please enter your email address.");
      return;
    }

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) {
      toast.error("Please enter a valid email address.");
      return;
    }

    setSavingEmail(true);

    try {
      const updatedEmail =
        await updateProfileEmail(normalizedEmail);

      setEmail(updatedEmail);

      setProfile((previous) =>
        previous
          ? { ...previous, email: updatedEmail }
          : previous,
      );

      toast.success("Email address updated successfully.");
    } catch (error: unknown) {
      toast.error(
        error instanceof Error
          ? error.message
          : "Unable to update your email.",
      );
    } finally {
      setSavingEmail(false);
    }
  };

  const handlePasswordUpdate = async (
    event: FormEvent<HTMLFormElement>,
  ) => {
    event.preventDefault();

    if (!currentPassword || !newPassword || !confirmPassword) {
      toast.error("Please complete all password fields.");
      return;
    }

    if (newPassword.length < 12) {
      toast.error(
        "Your new password must contain at least 12 characters.",
      );
      return;
    }

    if (newPassword !== confirmPassword) {
      toast.error("The new passwords do not match.");
      return;
    }

    setSavingPassword(true);

    try {
      await updateProfilePassword({
        current_password: currentPassword,
        new_password: newPassword,
        confirm_password: confirmPassword,
      });

      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");

      toast.success("Password changed successfully.");
    } catch (error: unknown) {
      toast.error(
        error instanceof Error
          ? error.message
          : "Unable to change your password.",
      );
    } finally {
      setSavingPassword(false);
    }
  };

  if (loading) {
    return (
      <div className="flex min-h-[300px] items-center justify-center">
        <Loader2 className="size-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!profile) {
    return (
      <div className="rounded-xl border border-input bg-popover p-6 text-sm text-muted-foreground">
        Unable to load your profile. Please refresh the page or
        sign in again.
      </div>
    );
  }

  const roleLabel = profile.role
    .replace(/_/g, " ")
    .toLowerCase()
    .replace(/\b\w/g, (character: string) => character.toUpperCase());

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      {/* Page heading */}
      <div>
        <h1 className="font-heading text-2xl font-semibold text-foreground">
          My Profile
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Manage your account information and security settings.
        </p>
      </div>

      {/* Account information */}
      <Card className="border-input bg-popover text-foreground">
        <CardHeader>
          <div className="flex items-center gap-2">
            <UserRound className="size-5 text-info" />
            <CardTitle className="text-base">
              Account Information
            </CardTitle>
          </div>

          <CardDescription className="text-muted-foreground">
            Your registered account details.
          </CardDescription>
        </CardHeader>

        <CardContent className="grid gap-5 sm:grid-cols-2">
          <div>
            <Label className="text-muted-foreground">Full Name</Label>
            <div className="mt-2 rounded-md border border-input bg-sidebar px-3 py-2.5 text-sm">
              {profile.display_name}
            </div>
          </div>

          <div>
            <Label className="text-muted-foreground">Role</Label>
            <div className="mt-2 rounded-md border border-input bg-sidebar px-3 py-2.5 text-sm">
              {roleLabel}
            </div>
          </div>

          <div>
            <Label className="text-muted-foreground">Department</Label>
            <div className="mt-2 rounded-md border border-input bg-sidebar px-3 py-2.5 text-sm">
              {profile.department || "Not assigned"}
            </div>
          </div>

          <div>
            <Label className="text-muted-foreground">Account Status</Label>
            <div className="mt-2 flex items-center gap-2 rounded-md border border-input bg-sidebar px-3 py-2.5 text-sm">
              <span className="size-2 rounded-full bg-emerald-400" />
              {profile.account_status}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Change email */}
      <Card className="border-input bg-popover text-foreground">
        <CardHeader>
          <div className="flex items-center gap-2">
            <Mail className="size-5 text-info" />
            <CardTitle className="text-base">
              Change Email Address
            </CardTitle>
          </div>

          <CardDescription className="text-muted-foreground">
            Update the email address associated with your account.
          </CardDescription>
        </CardHeader>

        <CardContent>
          <form onSubmit={handleEmailUpdate} className="space-y-4">
            <div className="max-w-xl space-y-2">
              <Label htmlFor="profile-email">
                Email Address
              </Label>

              <Input
                id="profile-email"
                type="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                required
                autoComplete="email"
                className="border-input bg-sidebar text-foreground"
              />
            </div>

            <Button
              type="submit"
              disabled={
                savingEmail ||
                email.trim().toLowerCase() ===
                  profile.email.toLowerCase()
              }
              className="gap-2"
            >
              {savingEmail ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <Save className="size-4" />
              )}
              Save Email
            </Button>
          </form>
        </CardContent>
      </Card>

      {/* Change password */}
      <Card className="border-input bg-popover text-foreground">
        <CardHeader>
          <div className="flex items-center gap-2">
            <LockKeyhole className="size-5 text-info" />
            <CardTitle className="text-base">
              Change Password
            </CardTitle>
          </div>

          <CardDescription className="text-muted-foreground">
            Verify your current password before choosing a new one.
          </CardDescription>
        </CardHeader>

        <CardContent>
          <form
            onSubmit={handlePasswordUpdate}
            className="max-w-xl space-y-4"
          >
            <div className="space-y-2">
              <Label htmlFor="current-password">
                Current Password
              </Label>

              <Input
                id="current-password"
                type="password"
                value={currentPassword}
                onChange={(event) =>
                  setCurrentPassword(event.target.value)
                }
                autoComplete="current-password"
                className="border-input bg-sidebar text-foreground"
                required
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="new-password">
                New Password
              </Label>

              <Input
                id="new-password"
                type="password"
                value={newPassword}
                onChange={(event) =>
                  setNewPassword(event.target.value)
                }
                autoComplete="new-password"
                minLength={12}
                className="border-input bg-sidebar text-foreground"
                required
              />

              <p className="text-xs text-muted-foreground">
                Use at least 12 characters.
              </p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="confirm-password">
                Confirm New Password
              </Label>

              <Input
                id="confirm-password"
                type="password"
                value={confirmPassword}
                onChange={(event) =>
                  setConfirmPassword(event.target.value)
                }
                autoComplete="new-password"
                minLength={12}
                className="border-input bg-sidebar text-foreground"
                required
              />
            </div>

            <Button
              type="submit"
              disabled={savingPassword}
              className="gap-2"
            >
              {savingPassword ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <ShieldCheck className="size-4" />
              )}
              Update Password
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
