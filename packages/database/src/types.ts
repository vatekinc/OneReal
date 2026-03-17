// Manually typed to match database schema (supabase gen types requires auth token)
// Re-generate with: pnpm dlx supabase gen types typescript --project-id kiyjjwkpmplsmidhblzx > packages/database/src/types.ts

export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

export type Database = {
  public: {
    Tables: {
      organizations: {
        Row: {
          id: string;
          name: string;
          slug: string;
          type: string;
          logo_url: string | null;
          settings: Json;
          plan_id: string;
          stripe_customer_id: string | null;
          stripe_account_id: string | null;
          stripe_account_status: string;
          stripe_subscription_id: string | null;
          subscription_status: string;
          subscription_period: string | null;
          subscription_current_period_end: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          name: string;
          slug: string;
          type: string;
          logo_url?: string | null;
          settings?: Json;
          plan_id: string;
          stripe_customer_id?: string | null;
          stripe_account_id?: string | null;
          stripe_account_status?: string;
          stripe_subscription_id?: string | null;
          subscription_status?: string;
          subscription_period?: string | null;
          subscription_current_period_end?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          name?: string;
          slug?: string;
          type?: string;
          logo_url?: string | null;
          settings?: Json;
          plan_id?: string;
          stripe_customer_id?: string | null;
          stripe_account_id?: string | null;
          stripe_account_status?: string;
          stripe_subscription_id?: string | null;
          subscription_status?: string;
          subscription_period?: string | null;
          subscription_current_period_end?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'organizations_plan_id_fkey';
            columns: ['plan_id'];
            isOneToOne: false;
            referencedRelation: 'plans';
            referencedColumns: ['id'];
          },
        ];
      };
      profiles: {
        Row: {
          id: string;
          first_name: string | null;
          last_name: string | null;
          email: string | null;
          phone: string | null;
          avatar_url: string | null;
          default_org_id: string | null;
          is_platform_admin: boolean;
          onboarding_completed: boolean;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id: string;
          first_name?: string | null;
          last_name?: string | null;
          email?: string | null;
          phone?: string | null;
          avatar_url?: string | null;
          default_org_id?: string | null;
          is_platform_admin?: boolean;
          onboarding_completed?: boolean;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          first_name?: string | null;
          last_name?: string | null;
          email?: string | null;
          phone?: string | null;
          avatar_url?: string | null;
          default_org_id?: string | null;
          is_platform_admin?: boolean;
          onboarding_completed?: boolean;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'profiles_default_org_id_fkey';
            columns: ['default_org_id'];
            isOneToOne: false;
            referencedRelation: 'organizations';
            referencedColumns: ['id'];
          },
        ];
      };
      org_members: {
        Row: {
          id: string;
          org_id: string;
          user_id: string;
          role: string;
          status: string;
          invited_at: string | null;
          joined_at: string | null;
        };
        Insert: {
          id?: string;
          org_id: string;
          user_id: string;
          role: string;
          status?: string;
          invited_at?: string | null;
          joined_at?: string | null;
        };
        Update: {
          id?: string;
          org_id?: string;
          user_id?: string;
          role?: string;
          status?: string;
          invited_at?: string | null;
          joined_at?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: 'org_members_org_id_fkey';
            columns: ['org_id'];
            isOneToOne: false;
            referencedRelation: 'organizations';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'org_members_user_id_fkey';
            columns: ['user_id'];
            isOneToOne: false;
            referencedRelation: 'profiles';
            referencedColumns: ['id'];
          },
        ];
      };
      properties: {
        Row: {
          id: string;
          org_id: string;
          name: string;
          type: string;
          status: string;
          address_line1: string | null;
          address_line2: string | null;
          city: string | null;
          state: string | null;
          zip: string | null;
          country: string;
          latitude: number | null;
          longitude: number | null;
          year_built: number | null;
          purchase_price: number | null;
          purchase_date: string | null;
          market_value: number | null;
          metadata: Json;
          notes: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          org_id: string;
          name: string;
          type: string;
          status?: string;
          address_line1?: string | null;
          address_line2?: string | null;
          city?: string | null;
          state?: string | null;
          zip?: string | null;
          country?: string;
          latitude?: number | null;
          longitude?: number | null;
          year_built?: number | null;
          purchase_price?: number | null;
          purchase_date?: string | null;
          market_value?: number | null;
          metadata?: Json;
          notes?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          org_id?: string;
          name?: string;
          type?: string;
          status?: string;
          address_line1?: string | null;
          address_line2?: string | null;
          city?: string | null;
          state?: string | null;
          zip?: string | null;
          country?: string;
          latitude?: number | null;
          longitude?: number | null;
          year_built?: number | null;
          purchase_price?: number | null;
          purchase_date?: string | null;
          market_value?: number | null;
          metadata?: Json;
          notes?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'properties_org_id_fkey';
            columns: ['org_id'];
            isOneToOne: false;
            referencedRelation: 'organizations';
            referencedColumns: ['id'];
          },
        ];
      };
      units: {
        Row: {
          id: string;
          property_id: string;
          unit_number: string;
          type: string | null;
          bedrooms: number | null;
          bathrooms: number | null;
          square_feet: number | null;
          rent_amount: number | null;
          deposit_amount: number | null;
          status: string;
          floor: number | null;
          features: Json;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          property_id: string;
          unit_number: string;
          type?: string | null;
          bedrooms?: number | null;
          bathrooms?: number | null;
          square_feet?: number | null;
          rent_amount?: number | null;
          deposit_amount?: number | null;
          status?: string;
          floor?: number | null;
          features?: Json;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          property_id?: string;
          unit_number?: string;
          type?: string | null;
          bedrooms?: number | null;
          bathrooms?: number | null;
          square_feet?: number | null;
          rent_amount?: number | null;
          deposit_amount?: number | null;
          status?: string;
          floor?: number | null;
          features?: Json;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'units_property_id_fkey';
            columns: ['property_id'];
            isOneToOne: false;
            referencedRelation: 'properties';
            referencedColumns: ['id'];
          },
        ];
      };
      property_images: {
        Row: {
          id: string;
          property_id: string;
          unit_id: string | null;
          url: string;
          caption: string | null;
          is_primary: boolean;
          sort_order: number;
          created_at: string;
        };
        Insert: {
          id?: string;
          property_id: string;
          unit_id?: string | null;
          url: string;
          caption?: string | null;
          is_primary?: boolean;
          sort_order?: number;
          created_at?: string;
        };
        Update: {
          id?: string;
          property_id?: string;
          unit_id?: string | null;
          url?: string;
          caption?: string | null;
          is_primary?: boolean;
          sort_order?: number;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'property_images_property_id_fkey';
            columns: ['property_id'];
            isOneToOne: false;
            referencedRelation: 'properties';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'property_images_unit_id_fkey';
            columns: ['unit_id'];
            isOneToOne: false;
            referencedRelation: 'units';
            referencedColumns: ['id'];
          },
        ];
      };
      leases: {
        Row: {
          id: string;
          org_id: string;
          unit_id: string;
          tenant_id: string;
          start_date: string | null;
          end_date: string | null;
          rent_amount: number | null;
          deposit_amount: number | null;
          payment_due_day: number | null;
          status: string | null;
          terms: Json;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          org_id: string;
          unit_id: string;
          tenant_id: string;
          start_date?: string | null;
          end_date?: string | null;
          rent_amount?: number | null;
          deposit_amount?: number | null;
          payment_due_day?: number | null;
          status?: string | null;
          terms?: Json;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          org_id?: string;
          unit_id?: string;
          tenant_id?: string;
          start_date?: string | null;
          end_date?: string | null;
          rent_amount?: number | null;
          deposit_amount?: number | null;
          payment_due_day?: number | null;
          status?: string | null;
          terms?: Json;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      transactions: {
        Row: {
          id: string;
          org_id: string;
          lease_id: string | null;
          unit_id: string;
          tenant_id: string | null;
          type: string | null;
          amount: number | null;
          payment_method: string | null;
          payment_status: string | null;
          stripe_payment_id: string | null;
          due_date: string | null;
          paid_date: string | null;
          description: string | null;
          notes: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          org_id: string;
          lease_id?: string | null;
          unit_id: string;
          tenant_id?: string | null;
          type?: string | null;
          amount?: number | null;
          payment_method?: string | null;
          payment_status?: string | null;
          stripe_payment_id?: string | null;
          due_date?: string | null;
          paid_date?: string | null;
          description?: string | null;
          notes?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          org_id?: string;
          lease_id?: string | null;
          unit_id?: string;
          tenant_id?: string | null;
          type?: string | null;
          amount?: number | null;
          payment_method?: string | null;
          payment_status?: string | null;
          stripe_payment_id?: string | null;
          due_date?: string | null;
          paid_date?: string | null;
          description?: string | null;
          notes?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      maintenance_requests: {
        Row: {
          id: string;
          org_id: string;
          unit_id: string;
          reported_by: string;
          assigned_to: string | null;
          title: string;
          description: string | null;
          priority: string | null;
          status: string | null;
          category: string | null;
          images: Json;
          estimated_cost: number | null;
          actual_cost: number | null;
          scheduled_date: string | null;
          completed_date: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          org_id: string;
          unit_id: string;
          reported_by: string;
          assigned_to?: string | null;
          title: string;
          description?: string | null;
          priority?: string | null;
          status?: string | null;
          category?: string | null;
          images?: Json;
          estimated_cost?: number | null;
          actual_cost?: number | null;
          scheduled_date?: string | null;
          completed_date?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          org_id?: string;
          unit_id?: string;
          reported_by?: string;
          assigned_to?: string | null;
          title?: string;
          description?: string | null;
          priority?: string | null;
          status?: string | null;
          category?: string | null;
          images?: Json;
          estimated_cost?: number | null;
          actual_cost?: number | null;
          scheduled_date?: string | null;
          completed_date?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      plans: {
        Row: {
          id: string;
          name: string;
          slug: string;
          max_properties: number;
          features: Json;
          is_default: boolean;
          monthly_price: number;
          yearly_price: number;
          stripe_product_id: string | null;
          stripe_monthly_price_id: string | null;
          stripe_yearly_price_id: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          name: string;
          slug: string;
          max_properties?: number;
          features?: Json;
          is_default?: boolean;
          monthly_price?: number;
          yearly_price?: number;
          stripe_product_id?: string | null;
          stripe_monthly_price_id?: string | null;
          stripe_yearly_price_id?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          name?: string;
          slug?: string;
          max_properties?: number;
          features?: Json;
          is_default?: boolean;
          monthly_price?: number;
          yearly_price?: number;
          stripe_product_id?: string | null;
          stripe_monthly_price_id?: string | null;
          stripe_yearly_price_id?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      invoices: {
        Row: {
          id: string;
          org_id: string;
          invoice_number: string;
          direction: string;
          status: string;
          lease_id: string | null;
          tenant_id: string | null;
          provider_id: string | null;
          property_id: string;
          unit_id: string | null;
          description: string;
          amount: number;
          amount_paid: number;
          due_date: string;
          issued_date: string;
          lease_charge_id: string | null;
          late_fee_for_invoice_id: string | null;
          stripe_checkout_session_id: string | null;
          stripe_payment_intent_id: string | null;
          convenience_fee: number;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          org_id: string;
          invoice_number: string;
          direction: string;
          status?: string;
          lease_id?: string | null;
          tenant_id?: string | null;
          provider_id?: string | null;
          property_id: string;
          unit_id?: string | null;
          description: string;
          amount: number;
          amount_paid?: number;
          due_date: string;
          issued_date: string;
          lease_charge_id?: string | null;
          late_fee_for_invoice_id?: string | null;
          stripe_checkout_session_id?: string | null;
          stripe_payment_intent_id?: string | null;
          convenience_fee?: number;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          org_id?: string;
          invoice_number?: string;
          direction?: string;
          status?: string;
          lease_id?: string | null;
          tenant_id?: string | null;
          provider_id?: string | null;
          property_id?: string;
          unit_id?: string | null;
          description?: string;
          amount?: number;
          amount_paid?: number;
          due_date?: string;
          issued_date?: string;
          lease_charge_id?: string | null;
          late_fee_for_invoice_id?: string | null;
          stripe_checkout_session_id?: string | null;
          stripe_payment_intent_id?: string | null;
          convenience_fee?: number;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      payment_events: {
        Row: {
          id: string;
          stripe_event_id: string;
          event_type: string;
          payload: Json;
          processed_at: string | null;
          error: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          stripe_event_id: string;
          event_type: string;
          payload: Json;
          processed_at?: string | null;
          error?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          stripe_event_id?: string;
          event_type?: string;
          payload?: Json;
          processed_at?: string | null;
          error?: string | null;
          created_at?: string;
        };
        Relationships: [];
      };
    };
    Views: Record<string, never>;
    Functions: Record<string, never>;
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
};
