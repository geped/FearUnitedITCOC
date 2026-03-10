const SUPABASE_URL = 'https://ubgpohirljxmnamuzuqi.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InViZ3BvaGlybGp4bW5hbXV6dXFpIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzMxNTA2MTUsImV4cCI6MjA4ODcyNjYxNX0.jzNKEKIVbAZtsmr7A4yKFtSLlXBteL21krw2W5xPjTI';

const { createClient } = supabase;
window.sb = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: { storageKey: 'fear-united-auth', persistSession: true }
});
