/**
 * The place guard behind the research-food answer: a restaurant, bakery, diner or bar & grill in
 * the name or brand that the person did not name is refused; the maker they named, by its fuller
 * name, and the words that are products rather than places are not. A table of positives AND
 * near-misses, because this is a router that fails silently — the wrong row would simply be
 * pinned (CLAUDE.md: every regex that decides behaviour gets its table).
 */
import { describe, expect, it } from 'vitest';
import { foldWords, placeNotAsked, type AskedFood } from './food-research-place.ts';

const rickards: AskedFood = { name: 'Red', brand: "Rickard's" };
const perkins: AskedFood = { name: 'pancakes', brand: 'Perkins' };

describe('placeNotAsked — a place they did not say', () => {
  it.each<[string, string, AskedFood, string]>([
    // The live answer of 2026-11-03, both fields.
    ['the restaurant as the brand', 'Perkins Restaurant & Bakery', rickards, 'Perkins Restaurant'],
    [
      'the restaurant in brackets after the name',
      "Rickard's Red Beer (Perkins Restaurant)",
      rickards,
      'Perkins Restaurant',
    ],
    // The chain's row title as FatSecret writes it — the row the lookup exists to get past.
    ['the restaurant in front of the name', "Perkins Restaurant Rickard's Red Beer", rickards, 'Perkins Restaurant'],
    ['after a dash', "Rickard's Red Beer - Perkins Restaurant", rickards, 'Perkins Restaurant'],
    [
      'after "at", by a fuller name',
      "Rickard's Red Beer at Perkins Family Restaurant",
      rickards,
      'Perkins Family Restaurant',
    ],
    [
      'run on after the maker they named',
      "Rickard's Red Beer Perkins Restaurant",
      rickards,
      'Red Beer Perkins Restaurant',
    ],
    [
      'a bar & grill for another chain',
      "Chili's Grill & Bar",
      { name: 'ribs', brand: "Applebee's" },
      "Chili's Grill & Bar",
    ],
    [
      'bar and grill, in brackets',
      "Baby Back Ribs (Chili's Bar and Grill)",
      { name: 'ribs', brand: "Applebee's" },
      "Chili's Bar and Grill",
    ],
    [
      'no maker named at all, a restaurant answered',
      'Perkins Restaurant & Bakery',
      { name: 'pancakes', brand: null },
      'Perkins Restaurant',
    ],
    ['a diner', "Joe's Diner", { name: 'burger', brand: "Wendy's" }, "Joe's Diner"],
    ['a pizzeria', "Luigi's Pizzeria", { name: 'pizza', brand: 'Dr. Oetker' }, "Luigi's Pizzeria"],
    ['a steakhouse', 'The Keg Steakhouse', { name: 'sirloin', brand: 'Costco' }, 'The Keg Steakhouse'],
    ['a bistro', 'Bistro Nouveau Chicken', { name: 'chicken', brand: 'Maple Leaf' }, 'Bistro'],
    // The cost the header accepts: a maker whose own name carries the word, found for a retailer.
    [
      'a maker named like a place, asked by retailer',
      'The Cheesecake Factory Bakery',
      { name: 'cheesecake', brand: 'Costco' },
      'The Cheesecake Factory Bakery',
    ],
    [
      'the apostrophe they typed does not matter',
      "Rickard's Red Beer (Perkins Restaurant)",
      { name: 'Red', brand: 'Rickard’s' },
      'Perkins Restaurant',
    ],
  ])('refuses %s', (_, field, asked, phrase) => {
    expect(placeNotAsked(field, asked)).toBe(phrase);
  });

  it.each<[string, string, AskedFood]>([
    // The place is the maker they named — a dish of its own.
    ['the maker they named, by its fuller name', 'Perkins Restaurant & Bakery', perkins],
    ['the maker they named in front of the dish', 'Perkins Restaurant Buttermilk Pancakes', perkins],
    ['one word between their words and the place word', 'Perkins Family Restaurant', perkins],
    ['two words between', 'Bob Evans Farms Restaurant', { name: 'sausage gravy', brand: 'Bob Evans' }],
    ['a bar & grill they named', "Chili's Grill & Bar", { name: 'ribs', brand: "Chili's" }],
    ['a bar & grill they named, curly apostrophe', "Chili's Grill & Bar", { name: 'ribs', brand: 'Chili’s' }],
    [
      'they said the word themselves',
      'Perkins Restaurant Pancakes',
      { name: 'pancakes from Perkins Restaurant', brand: null },
    ],
    // No place word at all.
    ["the maker's own record", "Rickard's Red Beer", rickards],
    ['the maker as the brand', 'Molson Coors', rickards],
    ['a plain dish', 'Buttermilk Pancakes', perkins],
    // Products, not places.
    [
      '"restaurant style" is a flavour',
      'Tostitos Restaurant Style Tortilla Chips',
      { name: 'tortilla chips', brand: 'Tostitos' },
    ],
    ['"restaurant-style" with a hyphen', 'Restaurant-Style Salsa', { name: 'salsa', brand: 'Old El Paso' }],
    ['a caffè latte is a drink', 'Caffè Latte', { name: 'latte', brand: 'Starbucks' }],
    ['Café Bustelo is a coffee maker', 'Café Bustelo', { name: 'coffee', brand: 'Costco' }],
    [
      'Grill Mates is a seasoning',
      'Grill Mates Montreal Steak Seasoning',
      { name: 'steak seasoning', brand: 'McCormick' },
    ],
    ['Bar Harbor is a chowder maker', 'Bar Harbor Foods', { name: 'clam chowder', brand: 'Costco' }],
    ['Pub Mix is a snack', 'Pub Mix', { name: 'snack mix', brand: 'Utz' }],
    ["Amy's Kitchen is a maker", "Amy's Kitchen", { name: 'burrito', brand: 'Costco' }],
    // The limit, named: a chain whose name carries no place word is the prompt's to keep out.
    ['a chain with no place word in its name', 'Boston Pizza', rickards],
  ])('passes %s', (_, field, asked) => {
    expect(placeNotAsked(field, asked)).toBeNull();
  });

  it('an empty field is no place', () => {
    expect(placeNotAsked('', rickards)).toBeNull();
  });
});

describe('foldWords — one spelling for the comparison', () => {
  it.each([
    ["Rickard's", 'rickards'],
    ['Rickard’s', 'rickards'],
    ['Café Bustelo', 'cafe bustelo'],
    ['Perkins Restaurant & Bakery', 'perkins restaurant bakery'],
    ['  Chili’s   Grill ', 'chilis grill'],
  ])('%s → %s', (raw, folded) => {
    expect(foldWords(raw)).toBe(folded);
  });
});
