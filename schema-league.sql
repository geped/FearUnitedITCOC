-- CoCBoard — Aggiunge colonna lega individuale per ogni giocatore
-- Esegui questo script nel SQL Editor di Supabase
-- https://supabase.com/dashboard/project/_/sql

ALTER TABLE public.members ADD COLUMN IF NOT EXISTS league_name TEXT;
ALTER TABLE public.members ADD COLUMN IF NOT EXISTS league_icon_url TEXT;
