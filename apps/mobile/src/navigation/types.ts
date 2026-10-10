import type { NavigatorScreenParams } from '@react-navigation/native';

export type TabParamList = {
  Home: undefined;
  Search: undefined;
  Recipes: undefined;
  Profile: undefined;
};

export type RootStackParamList = {
  Tabs: NavigatorScreenParams<TabParamList> | undefined;
  Category: { slug: string; title: string };
  Sale: undefined;
  Cart: undefined;
  ProductDetail: { product: import('../api/types').Product };
  RecipeDetail: { recipeId: number };
  Sco: undefined;
  Route: undefined;
  Auth: undefined;
  Settings: undefined;
  Feedback: undefined;
  RecipeAccess: undefined;
  Legal: { kind: 'terms' | 'privacy' | 'about' };
};
