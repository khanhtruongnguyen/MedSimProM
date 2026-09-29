-- Bổ sung cột model cá nhân cho admin/ultra (để họ tự đổi model trong Settings)
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS custom_main_model text NOT NULL DEFAULT '';
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS custom_judge_model text NOT NULL DEFAULT '';

-- Bảng settings chung (dùng cho model mặc định Pro/Vip/Free do admin đặt)
CREATE TABLE IF NOT EXISTS public.app_settings (
    id int PRIMARY KEY DEFAULT 1,
    group_main_model  text NOT NULL DEFAULT '',
    group_judge_model text NOT NULL DEFAULT '',
    updated_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT single_row CHECK (id = 1)
);

-- Chỉ admin mới sửa được app_settings (su đã có quyền, service key bypass RLS)
ALTER TABLE public.app_settings ENABLE ROW LEVEL SECURITY;
CREATE POLICY admin_only ON public.app_settings
    FOR ALL
    TO authenticated
    USING (EXISTS (
        SELECT 1 FROM public.profiles
        WHERE profiles.id = auth.uid() AND profiles.role = 'admin'
    ));

-- Insert dòng duy nhất (để fetch không trả về mảng rỗng)
INSERT INTO public.app_settings (id) VALUES (1) ON CONFLICT (id) DO NOTHING;
