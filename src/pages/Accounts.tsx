import { useEffect, useRef, useState, type ChangeEvent } from "react";
import { UserPlus, LogOut, RefreshCw, Copy, Check, ExternalLink, Camera, X } from "lucide-react";
import { convertFileSrc } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { useApp } from "../lib/store";
import { api, timeAgo } from "../lib/api";
import { toast } from "../lib/store";
import type { Account, DeviceCode } from "../lib/types";
import { Badge, Button, Card, EmptyState, RefreshButton, SpinnerBlock } from "../components/ui";
import { useT } from "../lib/i18n";

function useClipboard() {
  const [copied, setCopied] = useState(false);
  const copy = (text: string) => {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    });
  };
  return { copied, copy };
}

function SignInModal({ onClose }: { onClose: () => void }) {
  const t = useT();
  const [code, setCode] = useState<DeviceCode | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [waiting, setWaiting] = useState(false);
  const [mode, setMode] = useState<"idle" | "popup" | "device">("idle");
  const { refreshAccounts, refreshProfiles } = useApp();
  const clip = useClipboard();
  const timer = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (timer.current) clearInterval(timer.current);
    };
  }, []);

  useEffect(() => {
    let mounted = true;
    const un: Array<() => void> = [];
    listen<string>("ms_auth_code", async (e) => {
      if (!mounted) return;
      try {
        const acct = await api.msExchange(e.payload);
        toast(t("accounts.signedIn", { name: acct.playerName }));
        refreshAccounts();
        refreshProfiles();
        onClose();
      } catch (err) {
        setError(String(err));
      }
    }).then((h) => un.push(h));
    listen<string>("ms_auth_error", (e) => {
      if (!mounted) return;
      setError(String(e.payload));
      setMode("idle");
      setWaiting(false);
    }).then((h) => un.push(h));
    listen<string>("ms-auth-closed", () => {
      if (!mounted) return;
      setMode("idle");
      setWaiting(false);
    }).then((h) => un.push(h));
    return () => {
      mounted = false;
      un.forEach((off) => off());
    };
  }, [refreshAccounts, onClose]);

  const beginDevice = async () => {
    setError(null);
    try {
      const c = await api.deviceCode();
      setCode(c);
      setMode("device");
      setWaiting(true);
      navigator.clipboard
        .writeText(c.userCode)
        .then(() => toast(t("accounts.codeCopied")));
      window.open(c.verificationUri, "_blank");
      const intervalSec = Math.max(1, c.interval || 5);
      timer.current = window.setInterval(async () => {
        try {
          const acct = await api.msLogin(c.deviceCode, intervalSec, c.expiresIn);
          if (timer.current) clearInterval(timer.current);
          toast(t("accounts.signedIn", { name: acct.playerName }));
          refreshAccounts();
          refreshProfiles();
          onClose();
        } catch (e) {
          const msg = String(e);
          if (msg.includes("expired")) {
            if (timer.current) clearInterval(timer.current);
            setError(t("accounts.codeExpired"));
          } else if (msg.includes("declined")) {
            if (timer.current) clearInterval(timer.current);
            setError(t("accounts.declined"));
          } else if (!msg.includes("pending") && !msg.includes("slow")) {
            if (timer.current) clearInterval(timer.current);
            setError(msg);
          }
        }
      }, intervalSec * 1000);
    } catch (e) {
      setError(String(e));
    }
  };

  const begin = async () => {
    setError(null);
    try {
      await api.msStartPopup();
      setMode("popup");
      setWaiting(true);
    } catch (e) {
      const msg = String(e);
      if (/device[- ]code|azure/i.test(msg)) {
        beginDevice();
      } else {
        setError(msg);
      }
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/60" onClick={onClose} />
      <div className="relative w-[440px] rounded-[22px] glass shadow-lifted p-7">
        <h2 className="text-[17px] font-bold text-white">{t("accounts.signInTitle")}</h2>
        <p className="mt-1 text-[13px] text-white/45">
          {t("accounts.signInDesc")}
        </p>

        {mode === "idle" && (
          <div className="mt-6">
            <button
              onClick={begin}
              className="w-full flex items-center justify-center gap-2 px-4 py-3 rounded-xl bg-accent text-white font-medium text-sm hover:bg-accent-hover transition"
            >
              <UserPlus className="w-4 h-4" /> {t("accounts.signIn")}
            </button>
          </div>
        )}

        {mode === "popup" && (
          <div className="mt-6 space-y-4">
            <div className="rounded-2xl border border-dashed border-accent/50 bg-accent/5 p-6 text-center">
              <p className="text-sm text-white/75">{t("accounts.adding")}</p>
              {waiting && (
                <p className="mt-2 text-center text-white/35 animate-pulseSoft text-xs">
                  {t("accounts.windowHint")}
                </p>
              )}
            </div>
          </div>
        )}

        {mode === "device" && code && (
          <div className="mt-6 space-y-4">
            <div className="rounded-2xl border border-dashed border-accent/50 bg-accent/5 p-5 text-center">
              <button
                onClick={() => clip.copy(code.userCode)}
                className="font-mono text-[26px] font-bold tracking-[0.2em] text-white hover:text-accent transition"
              >
                {code.userCode}
                {clip.copied ? (
                  <Check className="w-5 h-5 text-green-400 ml-2 inline" />
                ) : (
                  <Copy className="w-5 h-5 text-white/40 ml-2 inline" />
                )}
              </button>
              <p className="mt-2 text-xs text-white/40">
                {t("accounts.copyHint")}
              </p>
              <button
                onClick={() => window.open(code.verificationUri, "_blank")}
                className="mt-3 inline-flex items-center gap-1.5 text-[13px] text-accent hover:underline"
              >
                {code.verificationUri} <ExternalLink className="w-3 h-3" />
              </button>
            </div>
            {waiting && (
              <p className="text-center text-white/35 animate-pulseSoft text-xs">
                {t("accounts.waiting")} {Math.max(1, Math.round(code.expiresIn / 60))} min
              </p>
            )}
          </div>
        )}

        {error && (
          <div className="mt-4 rounded-lg bg-red-500/10 border border-red-500/20 px-3 py-2 text-[13px] text-red-300">
            {error}
          </div>
        )}
      </div>
    </div>
  );
}

function DefaultHead() {
  return (
    <div className="absolute inset-0 flex items-center justify-center">
      <svg viewBox="0 0 64 64" className="w-[40px] h-[40px] shrink-0" aria-hidden>
        <circle cx="32" cy="24" r="13" fill="#9ca3af" />
        <path d="M6 62C8 47 18 40 32 40s24 7 26 22z" fill="#9ca3af" />
      </svg>
    </div>
  );
}

function SkinHead({
  account,
  onChanged,
}: {
  account: Account;
  onChanged: () => void,
}) {
  const t = useT();
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement | null>(null);

  const pickPicture = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async () => {
      const dataUrl = String(reader.result ?? "");
      if (!dataUrl.startsWith("data:image/")) {
        toast(t("accounts.picturePick"));
        return;
      }
      setBusy(true);
      try {
        await api.setAccountPicture(account.id, dataUrl);
        toast(t("accounts.pictureUpdated"));
        onChanged();
      } catch (err) {
        toast(String(err));
      } finally {
        setBusy(false);
      }
    };
    reader.readAsDataURL(file);
  };

  const removePicture = async () => {
    setBusy(true);
    try {
      await api.removeAccountPicture(account.id);
      toast(t("accounts.pictureRemoved"));
      onChanged();
    } catch (err) {
      toast(String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="w-[76px] h-[100px] rounded-2xl bg-gradient-to-b from-[#1e2026] to-[#111318] overflow-hidden shrink-0 border border-white/[0.07] relative shadow-soft group">
      {account.picture ? (
        <img
          src={convertFileSrc(account.picture)}
          alt={account.playerName}
          className="absolute inset-0 w-full h-full object-cover"
        />
      ) : (
        <DefaultHead />
      )}
      <div className="absolute inset-x-0 bottom-0 h-8 bg-gradient-to-t from-[#0d0f13] via-[#0d0f13]/55 to-transparent pointer-events-none" />
      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={pickPicture}
      />
      {account.picture && (
        <button
          onClick={removePicture}
          disabled={busy}
          title={t("accounts.pictureRemove")}
          className="absolute top-1 right-1 w-[22px] h-[22px] rounded-full bg-black/55 text-white/80 hover:text-white hover:bg-black/75 flex items-center justify-center transition z-10"
        >
          <X className="w-3 h-3" />
        </button>
      )}
      {!account.picture && (
        <button
          onClick={() => fileRef.current?.click()}
          disabled={busy}
          title={t("accounts.pictureSet")}
          className="absolute bottom-1.5 right-1.5 w-[24px] h-[24px] rounded-full bg-black/55 text-white/80 hover:text-accent hover:bg-black/75 flex items-center justify-center transition z-10"
        >
          <Camera className="w-3.5 h-3.5" />
        </button>
      )}
    </div>
  );
}

  function AccountCard({ account, onChanged }: { account: Account; onChanged: () => void }) {
  const t = useT();

  const logout = async () => {
    if (!confirm(t("accounts.signOutQ", { name: account.playerName }))) return;
    try {
      await api.logoutAccount(account.id);
      onChanged();
    } catch (e) {
      toast(String(e));
    }
  };

  const refresh = async () => {
    try {
      const updated = await api.refreshAccount(account.id);
      toast(t("accounts.refreshed", { name: updated.playerName }));
      onChanged();
    } catch (e) {
      toast(String(e));
    }
  };

  return (
    <Card className="p-5">
      <div className="flex items-center gap-4">
        <SkinHead account={account} onChanged={onChanged} />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-[16px] font-semibold text-white truncate">
              {account.playerName}
            </span>
            <Badge tone="blue">{account.accountType}</Badge>
          </div>
          <div className="text-[12px] text-white/40 mt-1 truncate">{account.username}</div>
          <div className="text-[11px] text-white/30 mt-0.5">
            {t("accounts.lastUsed")} {timeAgo(account.lastUsed)}
          </div>
        </div>
        <div className="flex flex-col items-end gap-2 shrink-0">
          <Button size="sm" variant="ghost" onClick={refresh}>
            <RefreshCw className="w-3.5 h-3.5" /> {t("accounts.refresh")}
          </Button>
          <Button
            size="sm"
            variant="ghost"
            className="text-red-400/80 hover:text-red-400"
            onClick={logout}
          >
            <LogOut className="w-3.5 h-3.5" /> {t("accounts.signOut")}
          </Button>
        </div>
      </div>
      {account.capes.length > 0 && (
        <div className="mt-3">
          <span className="text-[11px] uppercase tracking-wide text-white/35">{t("accounts.capes")}:</span>
          <div className="flex gap-1.5 mt-1.5 flex-wrap">
            {account.capes.map((c) => (
              <span
                key={c}
                className="px-2 py-0.5 rounded-full bg-white/[0.06] text-[11px] text-white/60"
              >
                {c}
              </span>
            ))}
          </div>
        </div>
      )}
    </Card>
  );
}

export default function AccountsPage() {
  const t = useT();
  const { accountCount, refreshAccounts, refreshProfiles, accountRefreshTick } = useApp();
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [signing, setSigning] = useState(false);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = () => {
    api
      .accounts()
      .then(setAccounts)
      .catch((e) => toast(e))
      .finally(() => setLoading(false));
  };

  useEffect(load, [accountCount, accountRefreshTick]);

  const refresh = () => {
    setRefreshing(true);
    Promise.all([api.accounts().then(setAccounts).catch((e) => toast(e)), refreshAccounts()])
      .catch(() => {})
      .finally(() => setRefreshing(false));
  };

  const header = (
    <div className="flex items-start justify-between gap-3">
      <div>
        <h1 className="text-[22px] font-bold text-white tracking-tight">{t("accounts.title")}</h1>
        <p className="text-sm text-white/45 mt-0.5">
          {t("accounts.sub")}
        </p>
      </div>
      <div className="flex items-center gap-2 shrink-0">
        <RefreshButton onClick={refresh} loading={refreshing} title={t("common.refresh")} />
        <Button variant="primary" onClick={() => setSigning(true)}>
          <UserPlus className="w-4 h-4" /> {t("accounts.add")}
        </Button>
      </div>
    </div>
  );

  return (
    <div className="space-y-6">
      {header}

      {loading ? (
        <SpinnerBlock label={t("accounts.loading")} />
      ) : accounts.length === 0 ? (
        <Card className="p-10">
          <EmptyState
            icon={<UserPlus className="w-5 h-5" />}
            title={t("accounts.emptyTitle")}
            body={t("accounts.emptyBody")}
          />
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {accounts.map((a) => (
            <AccountCard key={a.id} account={a} onChanged={() => { refreshAccounts(); load(); refreshProfiles(); }} />
          ))}
        </div>
      )}

      {signing && (
        <SignInModal
          onClose={() => {
            setSigning(false);
            load();
          }}
        />
      )}
    </div>
  );
}