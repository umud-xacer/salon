import { useMutation } from "@tanstack/react-query";
import { useState, type FormEvent } from "react";

import { api, json } from "../api/client";
import { useAuth } from "../auth/AuthProvider";
import { Modal } from "./Modal";
import { Button, ErrorNote, inputClass } from "./ui";

/** O'z paroli. Direktor bergan vaqtinchalik parolni xodim shu yerda almashtiradi. */
export function ChangePasswordDialog({ onClose }: { onClose: () => void }) {
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
    <Modal title="Parolni o'zgartirish" onClose={onClose}>
      <form onSubmit={submit} className="space-y-3">
        <label className="block text-sm">
          Hozirgi parol
          <input
            className={inputClass}
            type="password"
            autoComplete="current-password"
            value={oldPassword}
            onChange={(e) => setOldPassword(e.target.value)}
          />
          <span className="mt-1 block text-xs text-muted">Hali parol qo'ymagan bo'lsangiz, bo'sh qoldiring.</span>
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
    </Modal>
  );
}
