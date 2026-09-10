# Phase 4 parity checklist

Every user-visible behaviour of the pre-Phase-4 app, captured before refactoring `app.js` into
modules. Walk every line against the preview deployment before merging (task 4.7).

## Dashboard (index.html)
1. Loads and shows 4 stat tiles: total recipes, top cuisine (+ its count), vegetarian count, egg-free count
2. Shows a "Recently added" grid of up to 3 recipes, most recently created first
3. Clicking a recent-recipe card opens the recipe detail modal
4. Quick links section always shows static links to Recipes and Planner

## Recipe detail modal (shared: dashboard + recipes)
5. Shows title, meta chips (cuisine, serves, time or "Time TBD")
6. Shows ingredients grouped under their original group headings
7. Shows steps grouped under their original group headings, numbered
8. Shows a one-line nutrition summary (calories/protein/carbs/fat/fibre) plus the nutrition basis text
9. Shows a combined notes paragraph (egg check, common mistakes, UK sourcing, storage, kid-friendly), or "No additional notes."
10. Closes via the Close button or clicking the backdrop outside the panel
11. Only ever opens for a non-soft-deleted recipe

## Recipes page (recipes.html)
12. Search box filters by name/description (case-insensitive substring) on Enter or on blur/change — not live as you type
13. Cuisine dropdown filters by exact match, options populated from the distinct cuisine values across all recipes
14. Tag chips (populated from the union of every recipe's tags) toggle on/off; multiple selected tags AND together
15. Dietary chips (Vegetarian / Egg-free / Dairy-free) toggle exact-match filters
16. Toggling cuisine/tag/dietary filters doesn't refetch until "Apply filters" is clicked; search does refetch immediately
17. "Clear" resets every filter, the search box, and all chip active states, then reloads page 1
18. Grid shows 12 recipes per page with Previous/Next pagination, disabled at the first/last page
19. Page status text reads "Page X of Y"; result count text reads "N recipes"
20. Search box has an autocomplete datalist populated from every recipe's name and description
21. Each card shows name, cuisine, serves, time (or "Time TBD"), up to 4 tags, and Vegetarian/Egg-free/Dairy-free badges
22. Clicking a card body (not its icon buttons) opens the recipe detail modal
23. Each card has Edit (pencil) and Delete (bin) icon buttons that stop click propagation (don't also open the modal)
24. Edit opens the add/edit modal pre-filled with that recipe's data, titled "Edit recipe"
25. Delete opens a confirmation modal; confirming attempts a soft delete (update `is_deleted`/`deleted_at`)
26. The floating "+" button opens the same modal in add mode with a blank form, titled "Add a new recipe"
27. The form validates: name, cuisine, description required; serves > 0; total_time_minutes > 0; at least one ingredient line; at least one step line; calories/protein/carbs/fat/fibre ≥ 0 when present
28. Invalid fields get an inline error message and an error style; the first invalid field receives focus
29. A successful save shows a success snackbar, closes the modal, and refreshes the grid to page 1
30. The add/edit modal closes via Cancel, its own Close affordance, or clicking outside the panel, and resets the form each time
31. The delete-confirm modal closes via Cancel or clicking outside the panel
32. Snackbar messages (success or error) auto-dismiss after 3 seconds

## Planner page (planner.html)
33. Left sidebar lists up to 12 recipes matching the search text (name + description substring), from a pool of the first 50 recipes by name loaded once
34. Clicking a sidebar recipe selects it (highlighted) and updates "Selected: <name>" above the list
35. The board shows 7 days × 6 meal slots (Breakfast, Lunch, Dinner, Snacks, Dessert, Other)
36. Each slot has a "+" button; with a recipe selected, clicking it adds that recipe to the slot (replacing any existing entry for the same recipe+slot) and persists to `localStorage`
37. Clicking "+" with nothing selected shows a browser alert asking to select a recipe first
38. Each filled slot shows the recipe name and a Remove button; removing deletes just that entry and persists
39. "Reset week" clears the whole plan and the current selection, then persists the empty plan
40. The plan persists across reloads via the `recipeBookPlanner` `localStorage` key (format: `{ [day]: [{id, name, slot}] }`)

## Cross-cutting
41. Every dynamic value written into `innerHTML` is HTML-escaped
42. Soft-deleted recipes (`is_deleted = true`) are excluded from every list and can't be opened by id, on all three pages
43. The Supabase client is created once, with `auth.persistSession: false`
