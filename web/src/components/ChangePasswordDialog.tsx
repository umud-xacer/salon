import { useMutation } from "@tanstack/react-query";
import { useState, type FormEvent } from "react";

import { api, json } from "../api/client";
import { useAuth } from "../auth/AuthProvider";
import { Modal } from "./Modal";
import { Button, ErrorNote, inputClass } from "./ui";

export function ChangePasswordForm({ forced = false }: { forced?: boolean }) {
  const { signOut } = useAuth();
  const [oldPassword, setOldPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");

  const change = useMutation({
    mutationFn: () =>
      api("/auth/password", json("POST", { old_password: oldPassword || null, new_password: newPassword })),
    onSuccess: () => signOut(),       // parol o'zgarsa, barcha sessiyalar yopiladi
  });

  const submit = (e: FormEvent) => {
    e.preventDefault();
    change.mutate();
  };

  return (
    <form onSubmit={submit} className="space-y-3 text-left">
      <label className="block text-sm">
        {forced ? "Sizga berilgan parol" : "Hozirgi parol"}
        <input
          className={inputClass}
          type="password"
          autoComplete="current-password"
          required={forced}
          value={oldPassword}
          onChange={(e) => setOldPassword(e.target.value)}
        />
        {!forced && (
          <span className="mt-1 block text-xs text-muted">Hali parol qo'ymagan bo'lsangiz, bo'sh qoldiring.</span>
        )}
      </label>
      <label className="block text-sm">
        Yangi parol
        <input
          className={inputClass}
          type="password"
          autoComplete="new-password"
          required
          minLength={8}
          value={newPassword}
          onChange={(e) => setNewPassword(e.target.value)}
        />
        <span className="mt-1 block text-xs text-muted">Kamida 8 belgi, harf va raqam bilan.</span>
      </label>
      {change.error && <ErrorNote error={change.error} />}
      <Button type="submit" disabled={change.isPending} className="w-full">
        Saqlash va qayta kirish
      </Button>
    </form>
  );
}

/** O'z parolini o'zgartirish */
export function ChangePasswordDialog({ onClose }: { onClose: () => void }) {
  return (
    <Modal title="Parolni o'zgartirish" onClose={onClose}>
      <ChangePasswordForm />
    </Modal>
  );
}
