const supabaseUrl = 'https://xtxufygmwqicrgzjwdxc.supabase.co';
const supabaseKey = 'sb_publishable_G7NG8ND3HlxS5FFdj57TBQ_WRdgc23V';

window.recipeBookSupabase = window.supabase.createClient(supabaseUrl, supabaseKey, {
  auth: { persistSession: false }
});
