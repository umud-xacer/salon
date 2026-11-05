// O'z ismini tahrirlash (direktor, xodim, Super Admin). Ism shu telefon egasining hamma joyida bir xil.
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState, type FormEvent } from "react";

import { api, json } from "../api/client";
import { useAuth } from "../auth/AuthProvider";
import { Modal } from "./Modal";
import { Button, ErrorNote, inputClass } from "./ui";

export function ProfileNameDialog({ onClose }: { onClose: () => void }) {
  const { me } = useAuth();
  const queryClient = useQueryClient();
  const [name, setName] = useState(me?.user.full_name ?? "");
  const save = useMutation({
    mutationFn: () => api("/auth/me", json("PATCH", { full_name: name.trim() })),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["me"] });
      await queryClient.invalidateQueries({ queryKey: ["members"] });
      onClose();
    },
  });
  const submit = (e: FormEvent) => {
    e.preventDefault();
    save.mutate();
  };
  const shared = (me?.memberships.length ?? 0) > 1;

  return (
    <Modal title="Mening ismim" onClose={onClose}>
      <form onSubmit={submit} className="space-y-3">
        <label className="block text-sm">Ism familiya
          <input className={inputClass} required minLength={2} maxLength={120} value={name} data-autofocus
            onChange={(e) => setName(e.target.value)} />
        </label>
        <p className="text-xs text-muted">
          Telefon (login): <span className="tabular-nums">{me?.user.phone}</span>
          {shared && ". Ism siz ishlaydigan barcha muassasalarda o'zgaradi."}
        </p>
        {save.error && <ErrorNote error={save.error} />}
        <Button type="submit" disabled={save.isPending || name.trim().length < 2} className="w-full">Saqlash</Button>
      </form>
    </Modal>
  );
}
