# -*- coding: utf-8 -*-
import os
import sys
import re
import json
import time
import queue
import threading
import subprocess
import tkinter as tk
import tkinter.font as tkfont
from tkinter import messagebox, filedialog
import customtkinter as ctk

# CustomTkinter 기본 설정 (Slate / Indigo 테마 매칭)
ctk.set_appearance_mode("dark")
ctk.set_default_color_theme("blue")  # 기본 뼈대 블루

# 공통 현대 색상 팔레트 정의
COLOR_BG = "#030303"
COLOR_PANEL = "#0A0A0A"
COLOR_PANEL_SOFT = "#050505"
COLOR_PANEL_LIFT = "#141414"
COLOR_LINE = "#262626"
COLOR_TEXT = "#F5F5F5"
COLOR_MUTED = "#8A8A8A"
COLOR_BLUE = "#D4AF37"
COLOR_BLUE_HOVER = "#B99322"
COLOR_RED = "#FF4D4D"
COLOR_RED_PANEL = "#210707"
COLOR_ORANGE = "#F5A524"
COLOR_GREEN = "#20D07A"
COLOR_CONSOLE_BG = "#000000"
OLLAMA_LABEL = "Ollama Local (qwen3.5:9b)"
MODEL_OPTIONS = ["Gemini 3.1 Flash Lite", "Groq Llama 3.3 70B", "GPT-4o", OLLAMA_LABEL]
MODEL_MAP = {
    "Gemini 3.1 Flash Lite": "gemini",
    "Groq Llama 3.3 70B": "groq",
    "GPT-4o": "gpt",
    OLLAMA_LABEL: "ollama",
}

class PhishGuardGUI(ctk.CTk):
    def __init__(self):
        super().__init__()
        
        # 1. 메인 윈도우 사양 설정
        self.title("PhishGuard Prompt Evaluation & Testing Tool")
        self.geometry("1380x920")
        self.minsize(1300, 880)
        self.configure(fg_color=COLOR_BG)
        
        # 폰트 구성: Windows에서 Segoe UI/Consolas만 지정하면 한글이 깨질 수 있어
        # 한글 글리프가 있는 폰트를 우선 사용합니다.
        self.ui_font_family = self.pick_font_family("Malgun Gothic", "맑은 고딕", "Noto Sans KR", "Segoe UI")
        self.console_font_family = self.pick_font_family("D2Coding", "Cascadia Mono", "Malgun Gothic", "맑은 고딕", "Consolas")
        self.font_title = ctk.CTkFont(family=self.ui_font_family, size=20, weight="bold")
        self.font_subtitle = ctk.CTkFont(family=self.ui_font_family, size=11)
        self.font_label = ctk.CTkFont(family=self.ui_font_family, size=12, weight="bold")
        self.font_value = ctk.CTkFont(family=self.ui_font_family, size=12)
        self.font_badge = ctk.CTkFont(family=self.ui_font_family, size=11, weight="bold")
        self.font_console = ctk.CTkFont(family=self.console_font_family, size=10)
        
        # 스레드 제어 변수들
        self.process = None
        self.process_running = False
        self.gui_queue = queue.Queue()
        self.batch_records = []
        self.batch_card_widgets = []
        self.api_console_window = None
        self.api_console_box = None
        self.api_console_lines = []
        self.history_buttons = []
        self.batch_progress_active = False
        self.env_values = self.load_env_file()
        self.api_key_vars = {
            "gemini": ctk.StringVar(value=self.first_env_value("GEMINI_API_KEY", "GOOGLE_API_KEY", "GOOGLE_GENERATIVE_AI_API_KEY", "gemini_key", "gemini_api_key")),
            "groq": ctk.StringVar(value=self.first_env_value("GROQ_API_KEY", "groq_key", "groq_api_key")),
            "gpt": ctk.StringVar(value=self.first_env_value("OPENAI_API_KEY", "openai_key", "openai_api_key")),
        }
        self.batch_local_dataset_var = ctk.StringVar(value="")
        
        # 2. UI 레이아웃 생성
        self.create_layouts()
        
        # 3. 비동기 큐 모니터링 시작
        self.after(100, self.poll_queue)
        
        # 4. 기본 폴더 및 API 상태 진단
        self.check_environment()
        
        # 창 닫기 이벤트 핸들러
        self.protocol("WM_DELETE_WINDOW", self.on_closing)

    def pick_font_family(self, *candidates):
        """현재 PC에 설치된 후보 폰트 중 첫 번째를 반환합니다."""
        try:
            installed = {name.lower(): name for name in tkfont.families()}
            for candidate in candidates:
                if candidate.lower() in installed:
                    return installed[candidate.lower()]
        except Exception:
            pass
        return candidates[-1]

    def check_environment(self):
        """환경변수 및 API 키가 잘 로딩되었는지 검증하여 로깅"""
        env_keys = self.build_subprocess_env()
        gemini_ok = any(env_keys.get(k) for k in ['GEMINI_API_KEY', 'GOOGLE_API_KEY', 'gemini_key'])
        groq_ok = any(env_keys.get(k) for k in ['GROQ_API_KEY', 'groq_key'])
        gpt_ok = any(env_keys.get(k) for k in ['OPENAI_API_KEY', 'openai_key'])
        
        status_msg = "[시스템 상태] PhishGuard Python GUI 로드 완료.\n"
        status_msg += f"- Gemini Key: {'감지됨 (OK)' if gemini_ok else '없음 (Warning)'}\n"
        status_msg += f"- Groq Key: {'감지됨 (OK)' if groq_ok else '없음 (Warning)'}\n"
        status_msg += f"- GPT Key: {'감지됨 (OK)' if gpt_ok else '없음 (Warning)'}\n"
        status_msg += "----------------------------------------\n"
        
        self.append_log(status_msg)
        self.append_manual_log(status_msg)

    def load_env_file(self):
        """.env 파일을 안전하게 파싱"""
        env = {}
        env_path = os.path.join(os.path.abspath(os.path.dirname(__file__)), '..', '.env')
        if os.path.exists(env_path):
            try:
                with open(env_path, 'r', encoding='utf-8') as f:
                    for line in f:
                        line = line.strip()
                        if not line or line.startswith('#'):
                            continue
                        parts = line.split('=', 1)
                        if len(parts) == 2:
                            k, v = parts[0].strip(), parts[1].strip().strip('\'"')
                            env[k] = v
            except Exception:
                pass
        return env

    def first_env_value(self, *keys):
        """이미 저장된 .env 또는 환경변수에서 먼저 발견한 키 값을 반환"""
        for key in keys:
            value = self.env_values.get(key) or os.environ.get(key)
            if value:
                return value
        return ""

    def has_api_key_for_model(self, model):
        if model == "ollama":
            return True

        key_map = {
            "gemini": ["GEMINI_API_KEY", "GOOGLE_API_KEY", "GOOGLE_GENERATIVE_AI_API_KEY", "gemini_key", "gemini_api_key"],
            "groq": ["GROQ_API_KEY", "groq_key", "groq_api_key"],
            "gpt": ["OPENAI_API_KEY", "openai_key", "openai_api_key"],
        }
        if self.api_key_vars.get(model) and self.api_key_vars[model].get().strip():
            return True

        self.env_values = self.load_env_file()
        env = { **os.environ, **self.env_values }
        return any(env.get(key) for key in key_map.get(model, []))

    def reset_batch_run_state(self, status_text="대기 중"):
        self.stop_batch_activity()
        self.process_running = False
        self.btn_run.configure(state="normal")
        self.btn_stop.configure(state="disabled")
        self.lbl_status.configure(text=status_text)

    def create_api_key_section(self, parent):
        """모델 API 키 입력 UI를 생성하고 공용 StringVar에 바인딩"""
        api_frame = ctk.CTkFrame(parent, fg_color=COLOR_PANEL_SOFT, corner_radius=8)
        api_frame.pack(fill="x", pady=(0, 16))

        title = ctk.CTkLabel(api_frame, text="API Key 입력", font=self.font_label, text_color=COLOR_TEXT, anchor="w")
        title.pack(fill="x", padx=12, pady=(10, 4))

        hint = ctk.CTkLabel(api_frame, text="입력한 키는 실행 시 바로 적용됩니다.", font=self.font_subtitle, text_color=COLOR_MUTED, anchor="w")
        hint.pack(fill="x", padx=12, pady=(0, 8))

        key_specs = [
            ("Gemini", "gemini", "GEMINI_API_KEY / GOOGLE_API_KEY"),
            ("Groq", "groq", "GROQ_API_KEY"),
            ("GPT", "gpt", "OPENAI_API_KEY"),
        ]
        for label, key, placeholder in key_specs:
            row_label = ctk.CTkLabel(api_frame, text=label, font=self.font_subtitle, text_color=COLOR_MUTED, anchor="w")
            row_label.pack(fill="x", padx=12, pady=(4, 2))

            entry = ctk.CTkEntry(
                api_frame,
                textvariable=self.api_key_vars[key],
                placeholder_text=placeholder,
                show="*",
                fg_color=COLOR_BG,
                text_color=COLOR_TEXT,
                font=self.font_value,
                height=34
            )
            entry.pack(fill="x", padx=12, pady=(0, 6))

        btn_frame = ctk.CTkFrame(api_frame, fg_color="transparent")
        btn_frame.pack(fill="x", padx=12, pady=(8, 12))

        btn_save = ctk.CTkButton(
            btn_frame,
            text=".env에 저장",
            fg_color=COLOR_PANEL_LIFT,
            hover_color=COLOR_LINE,
            font=self.font_label,
            height=34,
            command=self.save_api_keys_to_env
        )
        btn_save.pack(side="left", fill="x", expand=True, padx=(0, 6))

        btn_console = ctk.CTkButton(
            btn_frame,
            text="API 콘솔",
            fg_color=COLOR_BLUE,
            hover_color=COLOR_BLUE_HOVER,
            font=self.font_label,
            height=34,
            command=self.open_api_console
        )
        btn_console.pack(side="left", fill="x", expand=True, padx=(6, 0))

    def build_subprocess_env(self):
        """GUI에 입력된 API 키를 Node 평가 프로세스 환경변수로 전달"""
        env = { **os.environ, **self.load_env_file() }
        key_map = {
            "gemini": ["GEMINI_API_KEY", "GOOGLE_API_KEY", "GOOGLE_GENERATIVE_AI_API_KEY"],
            "groq": ["GROQ_API_KEY"],
            "gpt": ["OPENAI_API_KEY"],
        }
        env.setdefault("OLLAMA_MODEL", "qwen3.5:9b")
        env.setdefault("OLLAMA_CHAT_URL", "http://localhost:11434/api/chat")
        for model, keys in key_map.items():
            value = self.api_key_vars[model].get().strip()
            if value:
                for key in keys:
                    env[key] = value
        return env

    def save_api_keys_to_env(self):
        """입력된 API 키를 프로젝트 루트 .env 파일에 저장"""
        env_path = os.path.join(os.path.abspath(os.path.dirname(__file__)), '..', '.env')
        updates = {
            "GEMINI_API_KEY": self.api_key_vars["gemini"].get().strip(),
            "GROQ_API_KEY": self.api_key_vars["groq"].get().strip(),
            "OPENAI_API_KEY": self.api_key_vars["gpt"].get().strip(),
        }
        updates = {key: value for key, value in updates.items() if value}

        if not updates:
            messagebox.showwarning("API Key 없음", "저장할 API Key를 먼저 입력해 주세요.")
            return

        lines = []
        seen = set()
        if os.path.exists(env_path):
            try:
                with open(env_path, 'r', encoding='utf-8') as f:
                    lines = f.read().splitlines()
            except Exception as e:
                messagebox.showerror(".env 읽기 실패", f".env 파일을 읽지 못했습니다:\n{str(e)}")
                return

        new_lines = []
        for line in lines:
            stripped = line.strip()
            key = stripped.split('=', 1)[0].strip() if '=' in stripped and not stripped.startswith('#') else None
            if key in updates:
                new_lines.append(f"{key}={updates[key]}")
                seen.add(key)
            else:
                new_lines.append(line)

        for key, value in updates.items():
            if key not in seen:
                new_lines.append(f"{key}={value}")

        try:
            with open(env_path, 'w', encoding='utf-8', newline='\n') as f:
                f.write("\n".join(new_lines).rstrip() + "\n")
            self.env_values = self.load_env_file()
            self.check_environment()
            messagebox.showinfo("저장 완료", ".env 파일에 API Key를 저장했습니다.")
        except Exception as e:
            messagebox.showerror(".env 저장 실패", f".env 파일을 저장하지 못했습니다:\n{str(e)}")

    def create_layouts(self):
        # 전체 탭 뷰 (Tabview) 구성 - Vercel 액센트 라인 모사
        self.tabview = ctk.CTkTabview(
            self,
            fg_color=COLOR_BG,
            segmented_button_fg_color=COLOR_PANEL,
            segmented_button_selected_color=COLOR_BLUE,
            segmented_button_selected_hover_color=COLOR_BLUE_HOVER,
            segmented_button_unselected_color=COLOR_PANEL,
            text_color=COLOR_TEXT,
            corner_radius=12
        )
        self.tabview.pack(fill="both", expand=True, padx=16, pady=16)
        
        self.tab_batch = self.tabview.add("데이터셋 일괄 평가")
        self.tab_manual = self.tabview.add("개별 메일 수동 테스트")
        self.tab_history = self.tabview.add("저장된 결과")
        
        # 탭 폰트 세팅
        self.tabview._segmented_button.configure(font=ctk.CTkFont(family=self.ui_font_family, size=13, weight="bold"))
        
        # 각 탭 빌드
        self.build_batch_tab()
        self.build_manual_tab()
        self.build_history_tab()

    def browse_local_dataset(self):
        file_path = filedialog.askopenfilename(
            title="로컬 데이터셋 JSON 선택",
            filetypes=[
                ("JSON / JSONL", "*.json *.jsonl"),
                ("All files", "*.*")
            ]
        )
        if file_path:
            self.batch_local_dataset_var.set(file_path)

    # =========================================================================
    # TAB 1: 데이터셋 일괄 평가 구현
    # =========================================================================
    def build_batch_tab(self):
        # 2분할 레이아웃
        self.batch_left = ctk.CTkFrame(self.tab_batch, width=430, fg_color=COLOR_PANEL, corner_radius=12)
        self.batch_left.pack(side="left", fill="both", padx=(0, 16), pady=4)
        self.batch_left.pack_propagate(False)
        
        self.batch_right = ctk.CTkFrame(self.tab_batch, fg_color="transparent")
        self.batch_right.pack(side="left", fill="both", expand=True, pady=4)
        
        # 1. 좌측 설정 패널 (Scrollable)
        self.batch_scroll = ctk.CTkScrollableFrame(self.batch_left, fg_color="transparent")
        self.batch_scroll.pack(fill="both", expand=True, padx=16, pady=16)
        
        # 타이틀부
        lbl_title = ctk.CTkLabel(self.batch_scroll, text="데이터셋 일괄 검사", font=self.font_title, text_color=COLOR_TEXT, anchor="w")
        lbl_title.pack(fill="x", pady=(0, 4))
        lbl_sub = ctk.CTkLabel(self.batch_scroll, text="background.js 프롬프트를 일괄 검증합니다.", font=self.font_subtitle, text_color=COLOR_MUTED, anchor="w")
        lbl_sub.pack(fill="x", pady=(0, 20))
        
        # 모델 선택
        self.create_section_label(self.batch_scroll, "인공지능 모델 (AI Model)")
        self.batch_model_var = ctk.StringVar(value="Gemini 3.1 Flash Lite")
        self.combo_model = ctk.CTkOptionMenu(
            self.batch_scroll, values=MODEL_OPTIONS,
            variable=self.batch_model_var, fg_color=COLOR_PANEL_SOFT, button_color=COLOR_PANEL_LIFT,
            button_hover_color=COLOR_LINE, dropdown_fg_color=COLOR_PANEL, text_color=COLOR_TEXT, font=self.font_value
        )
        self.combo_model.pack(fill="x", pady=(0, 16))

        self.create_api_key_section(self.batch_scroll)
        
        # 데이터셋 선택
        self.create_section_label(self.batch_scroll, "평가 데이터셋 (Dataset)")
        self.batch_dataset_var = ctk.StringVar(value="texts.json (이메일 텍스트)")
        self.combo_dataset = ctk.CTkOptionMenu(
            self.batch_scroll, values=[
                "texts.json (이메일 텍스트)", "urls.json (피싱 URL)", "webs.json (피싱 웹페이지)",
                "combined_reduced.json (축소 통합본)", "combined_full.json (전체 통합본)"
            ],
            variable=self.batch_dataset_var, fg_color=COLOR_PANEL_SOFT, button_color=COLOR_PANEL_LIFT,
            button_hover_color=COLOR_LINE, dropdown_fg_color=COLOR_PANEL, text_color=COLOR_TEXT, font=self.font_value
        )
        self.combo_dataset.pack(fill="x", pady=(0, 16))

        local_frame = ctk.CTkFrame(self.batch_scroll, fg_color=COLOR_PANEL_SOFT, corner_radius=8)
        local_frame.pack(fill="x", pady=(0, 16))

        local_title = ctk.CTkLabel(
            local_frame,
            text="로컬 데이터셋 JSON",
            font=self.font_label,
            text_color=COLOR_TEXT,
            anchor="w"
        )
        local_title.pack(fill="x", padx=12, pady=(10, 4))

        local_hint = ctk.CTkLabel(
            local_frame,
            text="선택하면 원격 다운로드 대신 이 파일을 사용합니다.",
            font=self.font_subtitle,
            text_color=COLOR_MUTED,
            anchor="w"
        )
        local_hint.pack(fill="x", padx=12, pady=(0, 8))

        local_entry = ctk.CTkEntry(
            local_frame,
            textvariable=self.batch_local_dataset_var,
            placeholder_text="예: data\\texts.json",
            fg_color=COLOR_BG,
            text_color=COLOR_TEXT,
            font=self.font_value,
            height=34
        )
        local_entry.pack(fill="x", padx=12, pady=(0, 8))

        local_btn_frame = ctk.CTkFrame(local_frame, fg_color="transparent")
        local_btn_frame.pack(fill="x", padx=12, pady=(0, 12))

        btn_browse_local = ctk.CTkButton(
            local_btn_frame,
            text="파일 선택",
            fg_color=COLOR_PANEL_LIFT,
            hover_color=COLOR_LINE,
            font=self.font_label,
            height=32,
            command=self.browse_local_dataset
        )
        btn_browse_local.pack(side="left", fill="x", expand=True, padx=(0, 6))

        btn_clear_local = ctk.CTkButton(
            local_btn_frame,
            text="해제",
            fg_color=COLOR_PANEL_LIFT,
            hover_color=COLOR_LINE,
            font=self.font_label,
            height=32,
            command=lambda: self.batch_local_dataset_var.set("")
        )
        btn_clear_local.pack(side="left", fill="x", expand=True, padx=(6, 0))
        
        # 샘플 수 슬라이더
        self.lbl_limit = self.create_section_label(self.batch_scroll, "평가 샘플 수 (Limit): 12")
        self.batch_limit_slider = ctk.CTkSlider(self.batch_scroll, from_=1, to=200, number_of_steps=199, command=self.on_limit_change)
        self.batch_limit_slider.set(12)
        self.batch_limit_slider.pack(fill="x", pady=(0, 16))
        
        # 시작 오프셋 슬라이더
        self.lbl_offset = self.create_section_label(self.batch_scroll, "샘플 시작 위치 (Offset): 0")
        self.batch_offset_slider = ctk.CTkSlider(self.batch_scroll, from_=0, to=1000, number_of_steps=1000, command=self.on_offset_change)
        self.batch_offset_slider.set(0)
        self.batch_offset_slider.pack(fill="x", pady=(0, 16))
        
        # 지연시간 슬라이더
        self.lbl_delay = self.create_section_label(self.batch_scroll, "호출 지연 시간 (Delay): 700 ms")
        self.batch_delay_slider = ctk.CTkSlider(self.batch_scroll, from_=0, to=5000, number_of_steps=50, command=self.on_delay_change)
        self.batch_delay_slider.set(700)
        self.batch_delay_slider.pack(fill="x", pady=(0, 20))

        self.lbl_repeat = self.create_section_label(self.batch_scroll, "반복 횟수: 1")
        self.batch_repeat_slider = ctk.CTkSlider(self.batch_scroll, from_=1, to=20, number_of_steps=19, command=self.on_repeat_change)
        self.batch_repeat_slider.set(1)
        self.batch_repeat_slider.pack(fill="x", pady=(0, 16))

        self.lbl_repeat_pause = self.create_section_label(self.batch_scroll, "반복 대기 시간: 0초")
        self.batch_repeat_pause_slider = ctk.CTkSlider(self.batch_scroll, from_=0, to=180, number_of_steps=36, command=self.on_repeat_pause_change)
        self.batch_repeat_pause_slider.set(0)
        self.batch_repeat_pause_slider.pack(fill="x", pady=(0, 20))
        
        # 균형 샘플링 토글
        self.batch_balanced_switch = ctk.CTkSwitch(
            self.batch_scroll, text="안전/피싱 라벨 균형 샘플링", text_color=COLOR_MUTED, font=self.font_label,
            progress_color=COLOR_BLUE, fg_color=COLOR_PANEL_SOFT
        )
        self.batch_balanced_switch.select()
        self.batch_balanced_switch.pack(anchor="w", pady=(0, 24))
        
        # 제어 버튼 세트
        btn_frame = ctk.CTkFrame(self.batch_scroll, fg_color="transparent")
        btn_frame.pack(fill="x", pady=(0, 10))
        
        self.btn_run = ctk.CTkButton(btn_frame, text="평가 실행", fg_color=COLOR_BLUE, hover_color=COLOR_BLUE_HOVER, font=self.font_label, height=44, command=self.start_batch_evaluation)
        self.btn_run.pack(side="left", fill="x", expand=True, padx=(0, 6))
        
        self.btn_stop = ctk.CTkButton(btn_frame, text="중단", fg_color=COLOR_RED, hover_color="#DC2626", font=self.font_label, height=44, state="disabled", command=self.stop_evaluation)
        self.btn_stop.pack(side="left", fill="x", expand=True, padx=(6, 0))
        
        # 2. 우측 보드 구성
        # 2.1 상단 상태 모듈 카드
        self.batch_status_card = ctk.CTkFrame(self.batch_right, fg_color=COLOR_PANEL, corner_radius=12, height=95)
        self.batch_status_card.pack(fill="x", pady=(0, 16))
        self.batch_status_card.pack_propagate(False)
        
        # 수평 메트릭 정보
        self.lbl_status = ctk.CTkLabel(self.batch_status_card, text="대기 중", font=ctk.CTkFont(family=self.ui_font_family, size=15, weight="bold"), text_color=COLOR_TEXT)
        self.lbl_status.place(x=20, y=14)
        
        self.lbl_accuracy = ctk.CTkLabel(self.batch_status_card, text="정확도: -", font=ctk.CTkFont(family=self.ui_font_family, size=15, weight="bold"), text_color=COLOR_GREEN)
        self.lbl_accuracy.place(x=260, y=14)
        
        self.lbl_progress = ctk.CTkLabel(self.batch_status_card, text="진행: 0 / 0", font=ctk.CTkFont(family=self.ui_font_family, size=15, weight="bold"), text_color=COLOR_TEXT)
        self.lbl_progress.place(x=460, y=14)

        self.lbl_progress_percent = ctk.CTkLabel(self.batch_status_card, text="0%", font=ctk.CTkFont(family=self.ui_font_family, size=15, weight="bold"), text_color=COLOR_BLUE)
        self.lbl_progress_percent.place(x=650, y=14)
        
        self.lbl_distribution = ctk.CTkLabel(self.batch_status_card, text="낮음(LOW) 0   보통(MEDIUM) 0   높음(HIGH) 0", font=self.font_subtitle, text_color=COLOR_MUTED)
        self.lbl_distribution.place(x=20, y=54)

        self.batch_progress_bar = ctk.CTkProgressBar(
            self.batch_status_card, width=820, height=10, progress_color=COLOR_BLUE, fg_color=COLOR_PANEL_SOFT
        )
        self.batch_progress_bar.set(0)
        self.batch_progress_bar.place(x=20, y=78)
        
        # 2.2 결과 리스트 카드 (Scrollable List of beautiful rows)
        self.batch_results_card = ctk.CTkFrame(self.batch_right, fg_color=COLOR_PANEL, corner_radius=12)
        self.batch_results_card.pack(fill="both", expand=True, pady=(0, 16))
        
        # 스크롤 영역 내부
        self.results_scroll = ctk.CTkScrollableFrame(self.batch_results_card, fg_color="transparent")
        self.results_scroll.pack(fill="both", expand=True, padx=12, pady=12)
        
        # 결과 대기 안내
        self.lbl_results_placeholder = ctk.CTkLabel(self.results_scroll, text="평가를 시작하면 분석 레코드가 카드로 쌓입니다.", font=self.font_subtitle, text_color=COLOR_MUTED)
        self.lbl_results_placeholder.pack(pady=40)
        
        # 2.3 상세 내용 정보 리더 카드
        self.batch_details_card = ctk.CTkFrame(self.batch_right, fg_color=COLOR_PANEL, corner_radius=12, height=190)
        self.batch_details_card.pack(fill="x", pady=(0, 16))
        self.batch_details_card.pack_propagate(False)
        
        self.details_box = ctk.CTkTextbox(self.batch_details_card, fg_color="transparent", text_color=COLOR_TEXT, font=self.font_console)
        self.details_box.pack(fill="both", expand=True, padx=16, pady=16)
        self.details_box.insert("1.0", "결과 리스트에서 레코드를 선택하면 보안 탐지 상세 사유 및 프롬프트 요약본을 확인할 수 있습니다.")
        
        # 2.4 백그라운드 CLI 터미널 로그 카드
        self.batch_log_card = ctk.CTkFrame(self.batch_right, fg_color=COLOR_PANEL, corner_radius=12, height=140)
        self.batch_log_card.pack(fill="x", pady=0)
        self.batch_log_card.pack_propagate(False)
        
        self.log_box = ctk.CTkTextbox(self.batch_log_card, fg_color=COLOR_CONSOLE_BG, text_color=COLOR_MUTED, font=self.font_console)
        self.log_box.pack(fill="both", expand=True, padx=16, pady=16)
        
    def create_section_label(self, parent, text):
        lbl = ctk.CTkLabel(parent, text=text, font=self.font_label, text_color=COLOR_MUTED, anchor="w")
        lbl.pack(fill="x", pady=(0, 6))
        return lbl
        
    def on_limit_change(self, val):
        self.lbl_limit.configure(text=f"평가 샘플 수 (Limit): {int(val)}")
        
    def on_offset_change(self, val):
        self.lbl_offset.configure(text=f"샘플 시작 위치 (Offset): {int(val)}")
        
    def on_delay_change(self, val):
        self.lbl_delay.configure(text=f"호출 지연 시간 (Delay): {int(val)} ms")

    def on_repeat_change(self, val):
        self.lbl_repeat.configure(text=f"반복 횟수: {int(val)}")

    def on_repeat_pause_change(self, val):
        self.lbl_repeat_pause.configure(text=f"반복 대기 시간: {int(val)}초")

    # =========================================================================
    # TAB 2: 개별 메일 수동 테스트 구현
    # =========================================================================
    def build_manual_tab(self):
        # 2분할 레이아웃
        self.manual_left = ctk.CTkFrame(self.tab_manual, width=430, fg_color=COLOR_PANEL, corner_radius=12)
        self.manual_left.pack(side="left", fill="both", padx=(0, 16), pady=4)
        self.manual_left.pack_propagate(False)
        
        self.manual_right = ctk.CTkFrame(self.tab_manual, fg_color="transparent")
        self.manual_right.pack(side="left", fill="both", expand=True, pady=4)
        
        # 1. 좌측 폼 입력 (Scrollable)
        self.manual_scroll = ctk.CTkScrollableFrame(self.manual_left, fg_color="transparent")
        self.manual_scroll.pack(fill="both", expand=True, padx=16, pady=16)
        
        # 타이틀부
        lbl_mtitle = ctk.CTkLabel(self.manual_scroll, text="수동 이메일 분석", font=self.font_title, text_color=COLOR_TEXT, anchor="w")
        lbl_mtitle.pack(fill="x", pady=(0, 4))
        lbl_msub = ctk.CTkLabel(self.manual_scroll, text="메일 정보를 임의 작성하여 실시간 검증합니다.", font=self.font_subtitle, text_color=COLOR_MUTED, anchor="w")
        lbl_msub.pack(fill="x", pady=(0, 20))
        
        # 발신자 이름
        self.create_section_label(self.manual_scroll, "발신자 이름 (Sender Name)")
        self.manual_sender_name = ctk.CTkEntry(self.manual_scroll, fg_color=COLOR_PANEL_SOFT, text_color=COLOR_TEXT, font=self.font_value, height=36)
        self.manual_sender_name.insert(0, "홍길동")
        self.manual_sender_name.pack(fill="x", pady=(0, 14))
        
        # 발신자 이메일 주소
        self.create_section_label(self.manual_scroll, "발신자 이메일 주소 (Sender Email)")
        self.manual_sender_email = ctk.CTkEntry(self.manual_scroll, fg_color=COLOR_PANEL_SOFT, text_color=COLOR_TEXT, font=self.font_value, height=36)
        self.manual_sender_email.insert(0, "gildong@example.com")
        self.manual_sender_email.pack(fill="x", pady=(0, 14))
        
        # 이메일 제목
        self.create_section_label(self.manual_scroll, "이메일 제목 (Subject)")
        self.manual_subject = ctk.CTkEntry(self.manual_scroll, fg_color=COLOR_PANEL_SOFT, text_color=COLOR_TEXT, font=self.font_value, height=36)
        self.manual_subject.insert(0, "[긴급] 계정이 일시 정지되었습니다. 본인 인증을 진행해 주세요.")
        self.manual_subject.pack(fill="x", pady=(0, 14))
        
        # 수신 날짜
        self.create_section_label(self.manual_scroll, "수신 시각 (Date)")
        self.manual_date = ctk.CTkEntry(self.manual_scroll, fg_color=COLOR_PANEL_SOFT, text_color=COLOR_TEXT, font=self.font_value, height=36)
        self.manual_date.insert(0, time.strftime("%Y-%m-%d %H:%M:%S"))
        self.manual_date.pack(fill="x", pady=(0, 14))
        
        # 본문 데이터
        self.create_section_label(self.manual_scroll, "이메일 본문 (Body)")
        self.manual_body = ctk.CTkTextbox(self.manual_scroll, fg_color=COLOR_PANEL_SOFT, text_color=COLOR_TEXT, font=self.font_value, height=180)
        self.manual_body.insert("1.0", "보안 문제로 인해 귀하의 계정이 일시 잠금되었습니다. 아래의 외부 인증 주소를 클릭하여 24시간 내에 본인 인증을 처리하지 않을 경우 계정이 전면 삭제 조치됩니다.\n\nhttp://phishguard-test-fake.com/login")
        self.manual_body.pack(fill="x", pady=(0, 16))
        
        # 모델 선택
        self.create_section_label(self.manual_scroll, "인공지능 모델 (AI Model)")
        self.manual_model_var = ctk.StringVar(value="Gemini 3.1 Flash Lite")
        self.combo_mmodel = ctk.CTkOptionMenu(
            self.manual_scroll, values=MODEL_OPTIONS,
            variable=self.manual_model_var, fg_color=COLOR_PANEL_SOFT, button_color=COLOR_PANEL_LIFT,
            button_hover_color=COLOR_LINE, dropdown_fg_color=COLOR_PANEL, text_color=COLOR_TEXT, font=self.font_value
        )
        self.combo_mmodel.pack(fill="x", pady=(0, 20))

        self.create_api_key_section(self.manual_scroll)
        
        # 버튼 영역
        btn_mframe = ctk.CTkFrame(self.manual_scroll, fg_color="transparent")
        btn_mframe.pack(fill="x", pady=(0, 10))
        
        self.btn_mrun = ctk.CTkButton(btn_mframe, text="분석 실행", fg_color=COLOR_BLUE, hover_color=COLOR_BLUE_HOVER, font=self.font_label, height=44, command=self.start_manual_evaluation)
        self.btn_mrun.pack(side="left", fill="x", expand=True, padx=(0, 6))
        
        self.btn_mreset = ctk.CTkButton(btn_mframe, text="초기화", fg_color=COLOR_PANEL_LIFT, hover_color=COLOR_LINE, font=self.font_label, height=44, command=self.reset_manual_fields)
        self.btn_mreset.pack(side="left", fill="x", expand=True, padx=(6, 0))
        
        # 2. 우측 보드 구성
        # 2.1 상단 위험 상태 및 신뢰도 게이지 카드
        self.manual_status_card = ctk.CTkFrame(self.manual_right, fg_color=COLOR_PANEL, corner_radius=12, height=95)
        self.manual_status_card.pack(fill="x", pady=(0, 16))
        self.manual_status_card.pack_propagate(False)
        
        lbl_status_title = ctk.CTkLabel(self.manual_status_card, text="분석 상태", font=ctk.CTkFont(family=self.ui_font_family, size=14, weight="bold"), text_color=COLOR_TEXT)
        lbl_status_title.place(x=20, y=14)
        
        # 위험도 등급 플랫 배지
        self.lbl_risk_badge = ctk.CTkLabel(
            self.manual_status_card, text="분석 대기", font=self.font_badge, text_color=COLOR_MUTED,
            fg_color=COLOR_PANEL_LIFT, corner_radius=6, width=130, height=36
        )
        self.lbl_risk_badge.place(x=20, y=44)
        
        # 신뢰도 수치 및 플랫 진행바
        self.lbl_confidence = ctk.CTkLabel(self.manual_status_card, text="신뢰도: -", font=self.font_label, text_color=COLOR_TEXT)
        self.lbl_confidence.place(x=220, y=14)
        
        self.confidence_progress = ctk.CTkProgressBar(
            self.manual_status_card, width=280, height=12, progress_color=COLOR_BLUE, fg_color=COLOR_PANEL_SOFT
        )
        self.confidence_progress.set(0)
        self.confidence_progress.place(x=220, y=56)
        
        # 2.2 의심 체크리스트 & 요약 분리형 프레임 (TableLayoutPanel 구현)
        self.manual_middle_frame = ctk.CTkFrame(self.manual_right, fg_color="transparent")
        self.manual_middle_frame.pack(fill="both", expand=True, pady=(0, 16))
        
        # 좌측 체크리스트 프레임 (가로 비율 50%)
        self.manual_chk_frame = ctk.CTkFrame(self.manual_middle_frame, fg_color=COLOR_PANEL, corner_radius=12)
        self.manual_chk_frame.pack(side="left", fill="both", expand=True, padx=(0, 8))
        
        lbl_chk_title = ctk.CTkLabel(self.manual_chk_frame, text="6대 의심 항목 체크리스트", font=self.font_label, text_color=COLOR_MUTED, anchor="w")
        lbl_chk_title.pack(fill="x", padx=16, pady=(12, 6))
        
        self.chk_scroll = ctk.CTkScrollableFrame(self.manual_chk_frame, fg_color="transparent")
        self.chk_scroll.pack(fill="both", expand=True, padx=10, pady=(0, 10))
        self.build_checklist_placeholder()
        
        # 우측 보안 요약 & 지표 프레임 (가로 비율 50%)
        self.manual_sum_frame = ctk.CTkFrame(self.manual_middle_frame, fg_color=COLOR_PANEL, corner_radius=12)
        self.manual_sum_frame.pack(side="left", fill="both", expand=True, padx=(8, 0))
        
        lbl_sum_title = ctk.CTkLabel(self.manual_sum_frame, text="보안 판단 요약 (Summary)", font=self.font_label, text_color=COLOR_MUTED, anchor="w")
        lbl_sum_title.pack(fill="x", padx=16, pady=(12, 4))
        
        self.txt_summary = ctk.CTkTextbox(self.manual_sum_frame, fg_color=COLOR_PANEL_SOFT, text_color=COLOR_TEXT, font=self.font_value, height=140)
        self.txt_summary.pack(fill="x", padx=16, pady=(0, 12))
        
        lbl_ind_title = ctk.CTkLabel(self.manual_sum_frame, text="탐지된 위협 지표 (Indicators)", font=self.font_label, text_color=COLOR_MUTED, anchor="w")
        lbl_ind_title.pack(fill="x", padx=16, pady=(0, 4))
        
        self.txt_indicators = ctk.CTkTextbox(self.manual_sum_frame, fg_color=COLOR_PANEL_SOFT, text_color=COLOR_TEXT, font=self.font_value, height=110)
        self.txt_indicators.pack(fill="both", expand=True, padx=16, pady=(0, 16))
        
        # 2.3 하단 디버그 서브 탭 컨트롤 카드
        self.manual_debug_card = ctk.CTkFrame(self.manual_right, fg_color=COLOR_PANEL, corner_radius=12, height=220)
        self.manual_debug_card.pack(fill="x", pady=0)
        self.manual_debug_card.pack_propagate(False)
        
        self.debug_tabview = ctk.CTkTabview(
            self.manual_debug_card,
            fg_color=COLOR_PANEL,
            segmented_button_fg_color=COLOR_PANEL,
            segmented_button_selected_color=COLOR_PANEL_SOFT,
            segmented_button_selected_hover_color=COLOR_PANEL_LIFT,
            segmented_button_unselected_color=COLOR_PANEL,
            text_color=COLOR_TEXT,
            corner_radius=12
        )
        self.debug_tabview.pack(fill="both", expand=True, padx=8, pady=4)
        
        self.tab_sys_prompt = self.debug_tabview.add("시스템 프롬프트")
        self.tab_user_prompt = self.debug_tabview.add("사용자 프롬프트")
        self.tab_raw_resp = self.debug_tabview.add("AI 원문 응답")
        self.tab_mlog = self.debug_tabview.add("실행 로그")
        
        # 디버그 서브 탭 텍스트박스들 연결
        self.txt_sys_prompt = ctk.CTkTextbox(self.tab_sys_prompt, fg_color=COLOR_CONSOLE_BG, text_color=COLOR_MUTED, font=self.font_console)
        self.txt_sys_prompt.pack(fill="both", expand=True, padx=6, pady=4)
        
        self.txt_user_prompt = ctk.CTkTextbox(self.tab_user_prompt, fg_color=COLOR_CONSOLE_BG, text_color=COLOR_MUTED, font=self.font_console)
        self.txt_user_prompt.pack(fill="both", expand=True, padx=6, pady=4)
        
        self.txt_raw_resp = ctk.CTkTextbox(self.tab_raw_resp, fg_color=COLOR_CONSOLE_BG, text_color=COLOR_MUTED, font=self.font_console)
        self.txt_raw_resp.pack(fill="both", expand=True, padx=6, pady=4)
        
        self.txt_mlog = ctk.CTkTextbox(self.tab_mlog, fg_color=COLOR_CONSOLE_BG, text_color=COLOR_MUTED, font=self.font_console)
        self.txt_mlog.pack(fill="both", expand=True, padx=6, pady=4)

    def build_checklist_placeholder(self):
        # 6대 체크리스트 초기 홀더 텍스트
        lbl = ctk.CTkLabel(self.chk_scroll, text="수동 이메일 분석을 진행하면\n6대 상세 분석 지표 카드가 리스팅됩니다.", font=self.font_subtitle, text_color=COLOR_MUTED)
        lbl.pack(pady=40)

    def build_history_tab(self):
        self.history_left = ctk.CTkFrame(self.tab_history, width=420, fg_color=COLOR_PANEL, corner_radius=12)
        self.history_left.pack(side="left", fill="both", padx=(0, 16), pady=4)
        self.history_left.pack_propagate(False)

        self.history_right = ctk.CTkFrame(self.tab_history, fg_color="transparent")
        self.history_right.pack(side="left", fill="both", expand=True, pady=4)

        header = ctk.CTkFrame(self.history_left, fg_color="transparent")
        header.pack(fill="x", padx=16, pady=(16, 10))

        title = ctk.CTkLabel(header, text="저장된 평가 결과", font=self.font_title, text_color=COLOR_TEXT, anchor="w")
        title.pack(side="left", fill="x", expand=True)

        btn_refresh = ctk.CTkButton(
            header,
            text="새로고침",
            width=92,
            height=30,
            fg_color=COLOR_PANEL_LIFT,
            hover_color=COLOR_LINE,
            font=self.font_subtitle,
            command=self.refresh_history_results
        )
        btn_refresh.pack(side="right")

        self.history_model_filter_var = ctk.StringVar(value="전체")
        self.history_model_filter = ctk.CTkOptionMenu(
            self.history_left,
            values=["전체", "Gemini", "Groq", "GPT", "Ollama"],
            variable=self.history_model_filter_var,
            fg_color=COLOR_PANEL_SOFT,
            button_color=COLOR_PANEL_LIFT,
            button_hover_color=COLOR_LINE,
            dropdown_fg_color=COLOR_PANEL,
            text_color=COLOR_TEXT,
            font=self.font_value,
            command=lambda _value: self.refresh_history_results()
        )
        self.history_model_filter.pack(fill="x", padx=16, pady=(0, 10))

        self.history_total_label = ctk.CTkLabel(
            self.history_left,
            text="누적 정확도: -",
            font=self.font_label,
            text_color=COLOR_GREEN,
            anchor="w"
        )
        self.history_total_label.pack(fill="x", padx=16, pady=(0, 4))

        self.history_total_detail_label = ctk.CTkLabel(
            self.history_left,
            text="완료된 결과를 집계합니다.",
            font=self.font_subtitle,
            text_color=COLOR_MUTED,
            anchor="w"
        )
        self.history_total_detail_label.pack(fill="x", padx=16, pady=(0, 10))

        self.history_list = ctk.CTkScrollableFrame(self.history_left, fg_color="transparent")
        self.history_list.pack(fill="both", expand=True, padx=12, pady=(0, 12))

        self.history_summary_card = ctk.CTkFrame(self.history_right, fg_color=COLOR_PANEL, corner_radius=12, height=180)
        self.history_summary_card.pack(fill="x", pady=(0, 16))
        self.history_summary_card.pack_propagate(False)

        self.history_summary_box = ctk.CTkTextbox(
            self.history_summary_card,
            fg_color=COLOR_PANEL_SOFT,
            text_color=COLOR_TEXT,
            font=self.font_console
        )
        self.history_summary_box.pack(fill="both", expand=True, padx=16, pady=16)

        self.history_records_card = ctk.CTkFrame(self.history_right, fg_color=COLOR_PANEL, corner_radius=12)
        self.history_records_card.pack(fill="both", expand=True)

        self.history_records_box = ctk.CTkTextbox(
            self.history_records_card,
            fg_color=COLOR_CONSOLE_BG,
            text_color=COLOR_MUTED,
            font=self.font_console
        )
        self.history_records_box.pack(fill="both", expand=True, padx=16, pady=16)

        self.refresh_history_results()

    # =========================================================================
    # 백그라운드 서브프로세스 파이프라인 제어 (Thread-safe Queue)
    # =========================================================================
    def append_log(self, text):
        """배치 로그에 쓰기"""
        self.log_box.insert("end", text)
        self.log_box.see("end")
        self.append_api_console(text)

    def append_manual_log(self, text):
        """수동 로그에 쓰기"""
        self.txt_mlog.insert("end", text)
        self.txt_mlog.see("end")
        self.append_api_console(text)

    def open_api_console(self):
        """API 호출 로그를 별도 창으로 표시"""
        if self.api_console_window is not None and self.api_console_window.winfo_exists():
            self.api_console_window.lift()
            self.api_console_window.focus()
            return

        self.api_console_window = ctk.CTkToplevel(self)
        self.api_console_window.title("PhishGuard API Console")
        self.api_console_window.geometry("980x560")
        self.api_console_window.minsize(760, 420)
        self.api_console_window.configure(fg_color=COLOR_BG)
        self.api_console_window.protocol("WM_DELETE_WINDOW", self.close_api_console)

        header = ctk.CTkFrame(self.api_console_window, fg_color=COLOR_PANEL, corner_radius=0, height=48)
        header.pack(fill="x")
        header.pack_propagate(False)

        title = ctk.CTkLabel(header, text="API Console", font=self.font_label, text_color=COLOR_TEXT, anchor="w")
        title.pack(side="left", padx=16)

        btn_clear = ctk.CTkButton(
            header,
            text="로그 지우기",
            width=100,
            height=30,
            fg_color=COLOR_PANEL_LIFT,
            hover_color=COLOR_LINE,
            font=self.font_subtitle,
            command=self.clear_api_console
        )
        btn_clear.pack(side="right", padx=16)

        self.api_console_box = ctk.CTkTextbox(
            self.api_console_window,
            fg_color=COLOR_CONSOLE_BG,
            text_color=COLOR_MUTED,
            font=self.font_console
        )
        self.api_console_box.pack(fill="both", expand=True, padx=12, pady=12)

        if self.api_console_lines:
            self.api_console_box.insert("1.0", "".join(self.api_console_lines))
            self.api_console_box.see("end")

    def close_api_console(self):
        """콘솔 창만 닫고 로그 버퍼는 유지"""
        if self.api_console_window is not None and self.api_console_window.winfo_exists():
            self.api_console_window.destroy()
        self.api_console_window = None
        self.api_console_box = None

    def clear_api_console(self):
        """API 콘솔 로그 비우기"""
        self.api_console_lines.clear()
        if self.api_console_box is not None and self.api_console_box.winfo_exists():
            self.api_console_box.delete("1.0", "end")

    def append_api_console(self, text):
        """별도 API 콘솔에도 로그를 누적"""
        if text is None:
            return
        self.api_console_lines.append(text)
        if len(self.api_console_lines) > 4000:
            self.api_console_lines = self.api_console_lines[-3000:]

        if self.api_console_box is not None and self.api_console_box.winfo_exists():
            self.api_console_box.insert("end", text)
            self.api_console_box.see("end")

    def get_eval_results_dir(self):
        return os.path.join(os.path.abspath(os.path.dirname(__file__)), '..', 'eval-results')

    def list_saved_results(self):
        eval_dir = self.get_eval_results_dir()
        if not os.path.exists(eval_dir):
            return []

        results = []
        for name in os.listdir(eval_dir):
            if not name.endswith('.jsonl'):
                continue
            jsonl_path = os.path.join(eval_dir, name)
            summary_path = jsonl_path.replace('.jsonl', '.summary.json')
            results.append({
                "name": name,
                "jsonl_path": jsonl_path,
                "summary_path": summary_path,
                "mtime": os.path.getmtime(jsonl_path),
                "has_summary": os.path.exists(summary_path),
                "model": self.get_saved_result_model(name, summary_path)
            })
        return sorted(results, key=lambda item: item["mtime"], reverse=True)

    def get_saved_result_model(self, name, summary_path):
        if os.path.exists(summary_path):
            try:
                with open(summary_path, 'r', encoding='utf-8') as f:
                    model = json.load(f).get("model")
                if model:
                    return str(model).lower()
            except Exception:
                pass

        lowered = name.lower()
        for model in ("gemini", "groq", "gpt", "ollama"):
            if f"-{model}-" in lowered:
                return model
        return "unknown"

    def filter_history_results(self, results):
        selected = self.history_model_filter_var.get() if hasattr(self, 'history_model_filter_var') else "전체"
        model_map = {
            "Gemini": "gemini",
            "Groq": "groq",
            "GPT": "gpt",
            "Ollama": "ollama"
        }
        model = model_map.get(selected)
        if not model:
            return results
        return [item for item in results if item.get("model") == model]

    def refresh_history_results(self):
        if not hasattr(self, 'history_list'):
            return

        for child in self.history_list.winfo_children():
            child.destroy()
        self.history_buttons.clear()

        results = self.filter_history_results(self.list_saved_results())
        self.update_history_totals(results)
        if not results:
            empty = ctk.CTkLabel(self.history_list, text="선택한 조건의 저장 결과가 없습니다.", font=self.font_subtitle, text_color=COLOR_MUTED)
            empty.pack(pady=24)
            return

        for item in results:
            btn = ctk.CTkButton(
                self.history_list,
                text=self.format_history_button_label(item),
                anchor="w",
                height=44,
                fg_color=COLOR_PANEL_SOFT,
                hover_color=COLOR_PANEL_LIFT,
                text_color=COLOR_TEXT,
                font=self.font_subtitle,
                command=lambda selected=item: self.load_history_result(selected)
            )
            btn.pack(fill="x", pady=4, padx=4)
            self.history_buttons.append(btn)

    def update_history_totals(self, results):
        total = 0
        with_label = 0
        correct = 0
        completed = 0
        by_risk = { "LOW": 0, "MEDIUM": 0, "HIGH": 0 }
        confusion = {
            "benignToBenign": 0,
            "benignToPhishing": 0,
            "phishingToBenign": 0,
            "phishingToPhishing": 0
        }

        for item in results:
            if not item.get("has_summary"):
                continue
            try:
                with open(item["summary_path"], 'r', encoding='utf-8') as f:
                    summary = json.load(f)
            except Exception:
                continue

            completed += 1
            total += int(summary.get("total", 0) or 0)
            with_label += int(summary.get("withLabel", 0) or 0)
            correct += int(summary.get("correct", 0) or 0)

            for key, value in (summary.get("byRisk", {}) or {}).items():
                by_risk[key] = by_risk.get(key, 0) + int(value or 0)
            for key, value in (summary.get("confusion", {}) or {}).items():
                confusion[key] = confusion.get(key, 0) + int(value or 0)

        accuracy = (correct / with_label * 100) if with_label else None
        self.history_total_label.configure(
            text=f"누적 정확도: {'-' if accuracy is None else f'{accuracy:.2f}%'}"
        )
        self.history_total_detail_label.configure(
            text=(
                f"완료 {completed}회 | 정답 {correct}/{with_label} | 총 {total}건 | "
                f"LOW {by_risk.get('LOW', 0)} MEDIUM {by_risk.get('MEDIUM', 0)} HIGH {by_risk.get('HIGH', 0)} | "
                f"FP {confusion.get('benignToPhishing', 0)} FN {confusion.get('phishingToBenign', 0)}"
            )
        )

    def format_history_button_label(self, item):
        stamp = time.strftime('%m-%d %H:%M:%S', time.localtime(item["mtime"]))
        base = item["name"].replace('phishing-prompt-', '').replace('.jsonl', '')
        mark = "OK" if item["has_summary"] else "RUN"
        return f"{mark}  {stamp}  [{item.get('model', '-')}]  {base}"

    def load_history_result(self, item):
        self.history_summary_box.delete("1.0", "end")
        self.history_summary_box.insert("1.0", self.build_history_summary_text(item))
        self.history_records_box.delete("1.0", "end")
        self.history_records_box.insert("1.0", self.build_history_records_text(item["jsonl_path"]))

    def build_history_summary_text(self, item):
        lines = [
            f"파일: {item['name']}",
            f"저장 시각: {time.strftime('%Y-%m-%d %H:%M:%S', time.localtime(item['mtime']))}",
            f"JSONL: {item['jsonl_path']}",
            ""
        ]

        if not item["has_summary"]:
            lines.append("요약 파일이 없습니다. 실행이 중단되었거나 완료 전에 종료된 결과일 수 있습니다.")
            return "\n".join(lines)

        try:
            with open(item["summary_path"], 'r', encoding='utf-8') as f:
                summary = json.load(f)
        except Exception as ex:
            lines.append(f"요약 파일을 읽지 못했습니다: {ex}")
            return "\n".join(lines)

        accuracy = summary.get("accuracy")
        by_risk = summary.get("byRisk", {})
        by_expected = summary.get("byExpected", {})
        confusion = summary.get("confusion", {})
        lines.extend([
            f"모델: {summary.get('model', '-')}",
            f"데이터셋: {summary.get('datasetName', '-')}",
            f"정확도: {'-' if accuracy is None else f'{accuracy * 100:.2f}%'}",
            f"정답: {summary.get('correct', 0)} / {summary.get('withLabel', 0)}",
            f"전체: {summary.get('total', 0)}",
            "",
            f"위험도 분포: LOW {by_risk.get('LOW', 0)} | MEDIUM {by_risk.get('MEDIUM', 0)} | HIGH {by_risk.get('HIGH', 0)}",
            f"정답 라벨: benign {by_expected.get('benign', 0)} | phishing {by_expected.get('phishing', 0)}",
            "",
            f"TN benign->benign: {confusion.get('benignToBenign', 0)}",
            f"FP benign->phishing: {confusion.get('benignToPhishing', 0)}",
            f"FN phishing->benign: {confusion.get('phishingToBenign', 0)}",
            f"TP phishing->phishing: {confusion.get('phishingToPhishing', 0)}",
        ])
        return "\n".join(lines)

    def build_history_records_text(self, jsonl_path):
        rows = []
        try:
            with open(jsonl_path, 'r', encoding='utf-8') as f:
                for line in f:
                    line = line.strip()
                    if line:
                        rows.append(json.loads(line))
        except Exception as ex:
            return f"결과 파일을 읽지 못했습니다: {ex}"

        if not rows:
            return "결과 레코드가 없습니다."

        chunks = []
        for index, record in enumerate(rows, 1):
            chunks.append("\n".join([
                f"[{index}] row={record.get('rowIndex')} expected={record.get('expectedName')} predicted={record.get('riskLevel')} correct={record.get('correct')}",
                f"confidence={record.get('confidence')} model={record.get('model')}",
                f"summary={record.get('summary', '')}",
                f"indicators={', '.join(record.get('indicators', []) or [])}",
                "-" * 90
            ]))
        return "\n".join(chunks)

    def start_manual_activity(self):
        """수동 분석 중임을 진행바 애니메이션으로 표시"""
        try:
            self.confidence_progress.configure(mode="indeterminate")
            self.confidence_progress.start()
        except Exception:
            self.confidence_progress.set(0.5)

    def stop_manual_activity(self):
        """수동 분석 진행 애니메이션을 정리"""
        try:
            self.confidence_progress.stop()
            self.confidence_progress.configure(mode="determinate")
        except Exception:
            pass

    def start_batch_activity(self):
        """결과 건수가 나오기 전의 다운로드/API 대기 상태를 진행바로 표시"""
        self.batch_progress_active = True
        try:
            self.batch_progress_bar.configure(mode="indeterminate")
            self.batch_progress_bar.start()
        except Exception:
            self.batch_progress_bar.set(0.08)

    def stop_batch_activity(self):
        """배치 진행바를 실제 퍼센트 표시 모드로 되돌림"""
        if not self.batch_progress_active:
            return
        self.batch_progress_active = False
        try:
            self.batch_progress_bar.stop()
            self.batch_progress_bar.configure(mode="determinate")
        except Exception:
            pass

    def poll_queue(self):
        """GUI 메인 스레드에서 100ms 주기로 돌며 비동기 스레드 작업 수신"""
        while not self.gui_queue.empty():
            try:
                task = self.gui_queue.get_nowait()
                task_type = task.get("type")
                
                if task_type == "log":
                    self.append_log(task.get("message"))
                elif task_type == "mlog":
                    self.append_manual_log(task.get("message"))
                elif task_type == "status":
                    self.lbl_status.configure(text=task.get("text"))
                elif task_type == "mstatus":
                    self.lbl_risk_badge.configure(text=task.get("text"), fg_color=COLOR_PANEL_LIFT, text_color=COLOR_MUTED)
                elif task_type == "progress":
                    self.stop_batch_activity()
                    current = int(task.get("current", 0))
                    total = max(int(task.get("total", 0)), 1)
                    progress = min(max(current / total, 0), 1)
                    self.lbl_progress.configure(text=f"진행: {current} / {total}")
                    self.lbl_progress_percent.configure(text=f"{progress * 100:.0f}%")
                    self.batch_progress_bar.set(progress)
                elif task_type == "download_progress":
                    self.stop_batch_activity()
                    percent = int(task.get("percent", 0))
                    progress = min(max(percent / 100, 0), 1)
                    self.lbl_status.configure(text="데이터셋 다운로드 중")
                    self.lbl_progress.configure(text="다운로드")
                    self.lbl_progress_percent.configure(text=f"{percent}%")
                    self.batch_progress_bar.set(progress)
                elif task_type == "api_progress":
                    self.stop_batch_activity()
                    current = int(task.get("current", 1))
                    total = max(int(task.get("total", 1)), 1)
                    progress = min(max((current - 0.5) / total, 0), 1)
                    self.lbl_status.configure(text=f"API 응답 대기 중 ({current}/{total})")
                    self.lbl_progress.configure(text=f"분석: {current} / {total}")
                    self.lbl_progress_percent.configure(text=f"{progress * 100:.0f}%")
                    self.batch_progress_bar.set(progress)
                elif task_type == "phase_progress":
                    self.stop_batch_activity()
                    percent = int(task.get("percent", 0))
                    self.lbl_status.configure(text=task.get("text", "진행 중"))
                    self.lbl_progress.configure(text=task.get("phase", "준비"))
                    self.lbl_progress_percent.configure(text=f"{percent}%")
                    self.batch_progress_bar.set(min(max(percent / 100, 0), 1))
                elif task_type == "metrics":
                    self.lbl_accuracy.configure(text=f"정확도: {task.get('accuracy')}")
                    self.lbl_distribution.configure(text=task.get("dist"))
                elif task_type == "record":
                    self.add_batch_result_card(task.get("record"))
                elif task_type == "mrecord":
                    self.render_manual_result(task.get("record"))
                elif task_type == "ended":
                    self.stop_manual_activity()
                    self.stop_batch_activity()
                    self.refresh_history_results()
                    if task.get("status") == "error":
                        self.lbl_status.configure(text="오류 발생")
                    elif task.get("status") == "stopped":
                        self.lbl_status.configure(text="중단됨")
                    else:
                        self.lbl_status.configure(text="완료")
                    self.process_running = False
                    self.btn_run.configure(state="normal")
                    self.btn_stop.configure(state="disabled")
                    self.btn_mrun.configure(state="normal")
                    self.btn_mreset.configure(state="normal")
            except queue.Empty:
                break
        self.after(100, self.poll_queue)

    def add_batch_result_card(self, record):
        """배치 평가 탭의 스크롤 결과 뷰에 모던한 가로형 카드 추가"""
        # 플레이스홀더가 존재하면 삭제
        if hasattr(self, 'lbl_results_placeholder') and self.lbl_results_placeholder:
            self.lbl_results_placeholder.destroy()
            self.lbl_results_placeholder = None
            
        index = len(self.batch_records)
        self.batch_records.append(record)
        
        # 개별 가로 행 카드 프레임 생성
        card = ctk.CTkFrame(self.results_scroll, fg_color=COLOR_PANEL, corner_radius=8, height=44)
        card.pack(fill="x", pady=4, padx=6)
        
        # 클릭 이벤트 연동 (아코디언 디테일 오픈)
        for widget in [card]:
            widget.bind("<Button-1>", lambda e, r=record, c=card: self.on_select_record(r, c))
            
        # 요소 1: 행 번호
        lbl_idx = ctk.CTkLabel(card, text=f"[{index + 1}]", font=ctk.CTkFont(family=self.ui_font_family, size=10, weight="bold"), text_color=COLOR_MUTED)
        lbl_idx.pack(side="left", padx=(12, 10))
        lbl_idx.bind("<Button-1>", lambda e, r=record, c=card: self.on_select_record(r, c))
        
        # 요소 2: 실제 라벨 (Expected)
        expected = record.get("expectedName", "unknown")
        exp_color = COLOR_GREEN if expected == "benign" else COLOR_RED
        lbl_exp = ctk.CTkLabel(card, text=f"실제: {expected}", font=ctk.CTkFont(family=self.ui_font_family, size=10, weight="bold"), text_color=exp_color)
        lbl_exp.pack(side="left", padx=10)
        lbl_exp.bind("<Button-1>", lambda e, r=record, c=card: self.on_select_record(r, c))
        
        # 요소 3: 예측 등급 (Predicted)
        risk = record.get("riskLevel", "LOW")
        risk_color = COLOR_RED if risk == "HIGH" else (COLOR_ORANGE if risk == "MEDIUM" else COLOR_GREEN)
        lbl_risk = ctk.CTkLabel(card, text=f"예측: {risk}", font=ctk.CTkFont(family=self.ui_font_family, size=10, weight="bold"), text_color=risk_color)
        lbl_risk.pack(side="left", padx=10)
        lbl_risk.bind("<Button-1>", lambda e, r=record, c=card: self.on_select_record(r, c))
        
        # 요소 4: 정확 여부 판단 뱃지 (OK / MISS)
        correct = record.get("correct", True)
        badge_txt = "성공" if correct else "실패"
        badge_bg = COLOR_GREEN if correct else COLOR_RED
        lbl_badge = ctk.CTkLabel(card, text=badge_txt, font=self.font_badge, text_color="white", fg_color=badge_bg, corner_radius=4, width=44, height=22)
        lbl_badge.pack(side="left", padx=10)
        lbl_badge.bind("<Button-1>", lambda e, r=record, c=card: self.on_select_record(r, c))
        
        # 요소 5: 텍스트 요약문 미리보기
        summary_txt = record.get("summary", "")
        if len(summary_txt) > 65:
            summary_txt = summary_txt[:62] + "..."
        lbl_summary = ctk.CTkLabel(card, text=summary_txt, font=ctk.CTkFont(family=self.ui_font_family, size=11), text_color=COLOR_TEXT, anchor="w")
        lbl_summary.pack(side="left", fill="x", expand=True, padx=(10, 12))
        lbl_summary.bind("<Button-1>", lambda e, r=record, c=card: self.on_select_record(r, c))
        
        # 관리 리스트에 넣어 색상 토글 지원
        self.batch_card_widgets.append((card, record))

    def add_batch_run_separator(self, model, dataset, limit, local_path, repeat_count=1):
        if hasattr(self, 'lbl_results_placeholder') and self.lbl_results_placeholder:
            self.lbl_results_placeholder.destroy()
            self.lbl_results_placeholder = None

        run_no = 1 + sum(
            1 for child in self.results_scroll.winfo_children()
            if getattr(child, "is_run_separator", False)
        )
        source = os.path.basename(local_path) if local_path else dataset
        label = f"RUN {run_no}  |  {time.strftime('%H:%M:%S')}  |  {model.upper()}  |  {source}  |  {limit} samples x {repeat_count}"

        sep = ctk.CTkFrame(self.results_scroll, fg_color=COLOR_PANEL_LIFT, corner_radius=6, height=30)
        sep.is_run_separator = True
        sep.pack(fill="x", pady=(10, 6), padx=6)
        sep.pack_propagate(False)

        lbl = ctk.CTkLabel(
            sep,
            text=label,
            font=self.font_badge,
            text_color=COLOR_MUTED,
            anchor="w"
        )
        lbl.pack(fill="both", expand=True, padx=12)

    def on_select_record(self, record, clicked_card):
        # 모든 카드 배경 원래대로
        for card, _ in self.batch_card_widgets:
            card.configure(fg_color=COLOR_PANEL)
        # 선택 카드 보라빛 하이라이트
        clicked_card.configure(fg_color="#334155")
        
        # 상세 데이터 출력
        self.details_box.delete("1.0", "end")
        
        details = f"=== [행 번호 {record.get('rowIndex', 0) + 1}] 이메일 정밀 보안 분석 결과 ===\n"
        details += f"- 모델: {record.get('model', '').upper()}\n"
        details += f"- 실제 데이터 라벨: {record.get('expectedName', 'unknown')}\n"
        details += f"- AI 예측 위협도: {record.get('riskLevel', 'LOW')} (신뢰도: {record.get('confidence', 0)}%)\n"
        details += f"- 판정 적합성: {'일치 (정확함)' if record.get('correct') else '오판 (불일치)'}\n"
        details += "----------------------------------------------------------------------\n"
        details += f"[보안 진단 요약]\n{record.get('summary', '(없음)')}\n\n"
        
        flagged = [item.get("text", "") for item in record.get("flaggedChecklist", [])]
        details += "[의심 탐지 기준 리스트]\n"
        if flagged:
            details += "\n".join([f"  ⚠️ {f}" for f in flagged]) + "\n\n"
        else:
            details += "  정상 (의심 지표가 검출되지 않음)\n\n"
            
        indicators = record.get("indicators", [])
        details += "[식별된 보안 지표 (Indicators)]\n"
        if indicators:
            details += ", ".join(indicators) + "\n\n"
        else:
            details += "  없음\n\n"
            
        details += f"[분석 대상 본문 미리보기]\n{record.get('textPreview', '')}\n"
        
        self.details_box.insert("1.0", details)

    # =========================================================================
    # TAB 1 & TAB 2: 백그라운드 노드 프로세스 비동기 연동 스레드
    # =========================================================================
    def start_batch_evaluation(self):
        if self.process_running:
            return
            
        self.process_running = True
        self.open_api_console()
        self.btn_run.configure(state="disabled")
        self.btn_stop.configure(state="normal")
        self.lbl_status.configure(text="연산 대기 중...")
        self.lbl_progress.configure(text="진행: 0 / 0")
        self.lbl_progress_percent.configure(text="대기")
        self.batch_progress_bar.set(0)
        self.start_batch_activity()
        
        # 결과 카드는 누적합니다. 로그/상세창만 현재 실행 기준으로 정리합니다.
        self.log_box.delete("1.0", "end")
        self.details_box.delete("1.0", "end")
        self.details_box.insert("1.0", "일괄 분석 중입니다...")
        
        # 모델명 및 데이터셋 단축값 매칭
        model_map = MODEL_MAP
        dataset_map = {
            "texts.json (이메일 텍스트)": "texts",
            "urls.json (피싱 URL)": "urls",
            "webs.json (피싱 웹페이지)": "webs",
            "combined_reduced.json (축소 통합본)": "combined_reduced",
            "combined_full.json (전체 통합본)": "combined_full"
        }
        
        model_val = model_map[self.batch_model_var.get()]
        if not self.has_api_key_for_model(model_val):
            model_label = self.batch_model_var.get()
            message = f"{model_label} API 키가 없습니다. 왼쪽 API Key 입력란에 키를 넣거나 .env에 저장해 주세요."
            self.append_log(f"\n{message}\n")
            self.append_api_console(f"\n{message}\n")
            self.details_box.delete("1.0", "end")
            self.details_box.insert("1.0", message)
            messagebox.showwarning("API Key 없음", message)
            self.reset_batch_run_state("API 키 없음")
            return

        dataset_val = dataset_map[self.batch_dataset_var.get()]
        limit_val = int(self.batch_limit_slider.get())
        offset_val = int(self.batch_offset_slider.get())
        delay_val = int(self.batch_delay_slider.get())
        repeat_count_val = int(self.batch_repeat_slider.get())
        repeat_pause_val = int(self.batch_repeat_pause_slider.get()) * 1000
        balanced = self.batch_balanced_switch.get()
        local_dataset_path = self.batch_local_dataset_var.get().strip()
        self.lbl_progress.configure(text=f"진행: 0 / {limit_val}")
        self.add_batch_run_separator(model_val, dataset_val, limit_val, local_dataset_path, repeat_count_val)
        
        # 비동기 실행 스레드 기동
        thread = threading.Thread(
            target=self.execute_node_subprocess,
            args=(model_val, dataset_val, limit_val, offset_val, delay_val, balanced, local_dataset_path, 5, 0, repeat_count_val, repeat_pause_val),
            daemon=True
        )
        thread.start()

    def start_manual_evaluation(self):
        if self.process_running:
            return
            
        # 입력 폼 정합성 확인
        body_text = self.manual_body.get("1.0", "end-1c").strip()
        subject_text = self.manual_subject.get().strip()
        if not body_text or not subject_text:
            messagebox.showwarning("입력 항목 누락", "이메일 제목과 본문을 반드시 기입해주세요.")
            return
            
        self.process_running = True
        self.open_api_console()
        self.btn_mrun.configure(state="disabled")
        self.btn_mreset.configure(state="disabled")
        self.lbl_risk_badge.configure(text="AI 분석 진행 중", fg_color=COLOR_BLUE, text_color="white")
        self.confidence_progress.set(0)
        self.lbl_confidence.configure(text="신뢰도: -")
        self.start_manual_activity()
        
        # 수동 탭 디버그 서브탭 데이터 초기화
        self.txt_sys_prompt.delete("1.0", "end")
        self.txt_user_prompt.delete("1.0", "end")
        self.txt_raw_resp.delete("1.0", "end")
        self.txt_mlog.delete("1.0", "end")
        self.txt_mlog.insert("1.0", "임시 JSON 빌드 및 분석 구동 시작...\n")
        self.append_api_console("임시 JSON 빌드 및 분석 구동 시작...\n")
        
        # 임시 이메일 레코드 JSON 구성 생성
        manual_record = {
            "label": "benign",  # 기본값 임시 맵핑
            "sender": self.manual_sender_name.get(),
            "senderEmail": self.manual_sender_email.get(),
            "subject": subject_text,
            "date": self.manual_date.get(),
            "text": body_text
        }
        
        # temp-custom.json 파일로 저장
        eval_dir = os.path.join(os.path.abspath(os.path.dirname(__file__)), '..', 'eval-results')
        os.makedirs(eval_dir, exist_ok=True)
        temp_json_path = os.path.join(eval_dir, 'temp-custom.json')
        
        try:
            with open(temp_json_path, 'w', encoding='utf-8') as f:
                json.dump([manual_record], f, ensure_ascii=False, indent=2)
        except Exception as e:
            self.stop_manual_activity()
            messagebox.showerror("임시 파일 생성 실패", f"수동 분석용 메일 구조 빌드에 실패했습니다:\n{str(e)}")
            self.process_running = False
            self.btn_mrun.configure(state="normal")
            self.btn_mreset.configure(state="normal")
            self.lbl_risk_badge.configure(text="분석 대기", fg_color=COLOR_PANEL_LIFT, text_color=COLOR_MUTED)
            return
            
        model_map = MODEL_MAP
        model_val = model_map[self.manual_model_var.get()]
        if not self.has_api_key_for_model(model_val):
            model_label = self.manual_model_var.get()
            message = f"{model_label} API 키가 없습니다. 왼쪽 API Key 입력란에 키를 넣거나 .env에 저장해 주세요."
            self.append_manual_log(f"\n{message}\n")
            self.append_api_console(f"\n{message}\n")
            messagebox.showwarning("API Key 없음", message)
            self.stop_manual_activity()
            self.process_running = False
            self.btn_mrun.configure(state="normal")
            self.btn_mreset.configure(state="normal")
            self.lbl_risk_badge.configure(text="API 키 없음", fg_color=COLOR_PANEL_LIFT, text_color=COLOR_MUTED)
            return
        
        # 수동 분석 비동기 스레드 기동 (temp_custom 데이터셋 이용)
        thread = threading.Thread(
            target=self.execute_node_subprocess,
            args=(model_val, "temp_custom", 1, 0, 0, False, temp_json_path, 1, 0, 1, 0),
            daemon=True
        )
        thread.start()

    def execute_node_subprocess(self, model, dataset, limit, offset, delay, balanced, local_path, chunk_count=5, chunk_pause=0, repeat_count=1, repeat_pause=0):
        """스레드 내부에서 호출되는 노드 CLI 구동용 유틸"""
        proj_dir = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))
        cli_script = os.path.join(proj_dir, 'tools', 'evaluate-phishing-prompt.mjs')
        
        cmd = ["node", cli_script, "--model", model, "--dataset", dataset]
        if local_path:
            cmd += ["--local", local_path]
        cmd += [
            "--limit", str(limit),
            "--offset", str(offset),
            "--delay", str(delay),
            "--chunk-count", str(chunk_count),
            "--chunk-pause", str(chunk_pause),
            "--repeat", str(repeat_count),
            "--repeat-pause", str(repeat_pause)
        ]
        if not balanced:
            cmd += ["--no-balanced"]
                
        # 로그 알림 전송
        target_log_type = "mlog" if dataset == "temp_custom" else "log"
        self.gui_queue.put({"type": target_log_type, "message": f"실행 커맨드: {' '.join(cmd)}\n\n"})
        self.gui_queue.put({"type": target_log_type, "message": "데이터셋 준비 및 API 응답을 기다리는 중입니다...\n"})
        self.gui_queue.put({"type": "mstatus" if dataset == "temp_custom" else "status", "text": "데이터셋/API 대기 중..."})
        
        # 이전 분석 리스트 캐싱 삭제를 위해 파일 위치 파악 준비
        last_jsonl_mtime = 0
        latest_jsonl_file = self.find_latest_jsonl(proj_dir, model, dataset)
        if latest_jsonl_file:
            last_jsonl_mtime = os.path.getmtime(latest_jsonl_file)

        end_status = "ok"
        try:
            # 윈도우 검은색 콘솔창 팝업 제거 플래그
            creation_flags = 0
            if os.name == 'nt':
                creation_flags = subprocess.CREATE_NO_WINDOW
                
            self.process = subprocess.Popen(
                cmd,
                stdout=subprocess.PIPE,
                stderr=subprocess.STDOUT,
                text=True,
                bufsize=1,
                encoding='utf-8',
                cwd=proj_dir,
                env=self.build_subprocess_env(),
                creationflags=creation_flags
            )
            
            # 실시간 로그 수신 루프
            for line in iter(self.process.stdout.readline, ''):
                if not self.process_running:
                    break
                self.gui_queue.put({"type": target_log_type, "message": line})
                download_match = re.search(r'데이터셋 다운로드:\s+(\d+)%', line)
                if download_match and dataset != "temp_custom":
                    self.gui_queue.put({"type": "download_progress", "percent": int(download_match.group(1))})
                if "데이터셋 로드 완료" in line and dataset != "temp_custom":
                    self.gui_queue.put({"type": "phase_progress", "text": "데이터셋 로드 완료", "phase": "샘플 준비", "percent": 5})
                if "평가 샘플 선택 완료" in line and dataset != "temp_custom":
                    self.gui_queue.put({"type": "phase_progress", "text": "평가 샘플 선택 완료", "phase": "API 준비", "percent": 8})
                api_match = re.search(r'\[(\d+)/(\d+)\]\s+API (?:배치 )?호출 중', line)
                if api_match and dataset != "temp_custom":
                    self.gui_queue.put({
                        "type": "api_progress",
                        "current": int(api_match.group(1)),
                        "total": int(api_match.group(2))
                    })
                
                # 정규식을 이용해 진행 현황 분석
                # 예: [1/12] OK row=0 expected=benign predicted=LOW confidence=90
                prog_match = re.search(r'\[(\d+)/(\d+)\]\s+(\w+)\s+row=(\d+)\s+expected=(\w+)\s+predicted=(\w+)\s+confidence=(\d+)', line)
                if prog_match and dataset != "temp_custom":
                    curr, total = int(prog_match.group(1)), int(prog_match.group(2))
                    self.gui_queue.put({"type": "progress", "current": curr, "total": total})
                    
                    # 실시간 생성된 JSONL 파일의 마지막 줄을 읽어서 카드로 추가
                    latest_file = self.find_latest_jsonl(proj_dir, model, dataset)
                    if latest_file:
                        rec = self.read_last_jsonl_line(latest_file)
                        if rec:
                            self.gui_queue.put({"type": "record", "record": rec})
                            
                # 일괄 평가 완료 정확도 통계 문구 감지
                # 예: - 정확도: 0.9167, LOW: 1, MEDIUM: 0, HIGH: 11
                acc_match = re.search(r'-\s+결과:.*\.jsonl', line)
                if acc_match and dataset != "temp_custom":
                    # 최종 완료된 요약 정보를 최신 JSONL 근처에서 파싱
                    latest_file = self.find_latest_jsonl(proj_dir, model, dataset)
                    if latest_file:
                        summary_file = latest_file.replace('.jsonl', '.summary.json')
                        if os.path.exists(summary_file):
                            try:
                                with open(summary_file, 'r', encoding='utf-8') as sf:
                                    sdata = json.load(sf)
                                    accuracy_pct = f"{sdata.get('accuracy', 0) * 100:.2f}%"
                                    by_risk = sdata.get('byRisk', {})
                                    dist_str = f"LOW {by_risk.get('LOW', 0)}   MEDIUM {by_risk.get('MEDIUM', 0)}   HIGH {by_risk.get('HIGH', 0)}"
                                    self.gui_queue.put({
                                        "type": "metrics",
                                        "accuracy": accuracy_pct,
                                        "dist": dist_str
                                    })
                            except Exception:
                                pass
            
            return_code = self.process.wait()
            if not self.process_running:
                end_status = "stopped"
            
            # 완료 후 최종 수동 분석 기록 수신 처리
            if dataset == "temp_custom":
                latest_file = self.find_latest_jsonl(proj_dir, model, dataset)
                if latest_file and os.path.getmtime(latest_file) > last_jsonl_mtime:
                    rec = self.read_last_jsonl_line(latest_file)
                    if rec:
                        self.gui_queue.put({"type": "mrecord", "record": rec})
            elif return_code == 0:
                latest_file = self.find_latest_jsonl(proj_dir, model, dataset)
                self.queue_summary_metrics(latest_file)
            if return_code != 0:
                self.gui_queue.put({"type": target_log_type, "message": f"\n프로세스가 오류 코드 {return_code}로 종료되었습니다.\n"})
                end_status = "error"
                        
        except Exception as ex:
            self.gui_queue.put({"type": target_log_type, "message": f"\n에러 발생: {str(ex)}\n"})
            end_status = "error"
        finally:
            self.gui_queue.put({"type": "ended", "status": end_status})

    def find_latest_jsonl(self, proj_dir, model, dataset):
        eval_results_dir = os.path.join(proj_dir, 'eval-results')
        if not os.path.exists(eval_results_dir):
            return None
        files = [
            os.path.join(eval_results_dir, f)
            for f in os.listdir(eval_results_dir)
            if f.endswith('.jsonl') and model in f and dataset in f
        ]
        if not files:
            return None
        return max(files, key=os.path.getmtime)

    def queue_summary_metrics(self, jsonl_path):
        if not jsonl_path:
            return

        summary_file = jsonl_path.replace('.jsonl', '.summary.json')
        if not os.path.exists(summary_file):
            return

        try:
            with open(summary_file, 'r', encoding='utf-8') as sf:
                summary = json.load(sf)

            accuracy = summary.get('accuracy')
            accuracy_pct = '-' if accuracy is None else f"{accuracy * 100:.2f}%"
            by_risk = summary.get('byRisk', {})
            confusion = summary.get('confusion', {})
            dist_str = (
                f"총 {summary.get('total', 0)}   "
                f"정답 {summary.get('correct', 0)} / {summary.get('withLabel', 0)}   "
                f"LOW {by_risk.get('LOW', 0)}   MEDIUM {by_risk.get('MEDIUM', 0)}   HIGH {by_risk.get('HIGH', 0)}   "
                f"FP {confusion.get('benignToPhishing', 0)}   FN {confusion.get('phishingToBenign', 0)}"
            )
            self.gui_queue.put({
                "type": "metrics",
                "accuracy": accuracy_pct,
                "dist": dist_str
            })
        except Exception as ex:
            self.gui_queue.put({"type": "log", "message": f"\n통계 파일을 읽지 못했습니다: {ex}\n"})

    def read_last_jsonl_line(self, file_path):
        try:
            with open(file_path, 'r', encoding='utf-8') as f:
                lines = f.readlines()
                if lines:
                    return json.loads(lines[-1].strip())
        except Exception:
            pass
        return None

    def stop_evaluation(self):
        """현재 진행 중인 백그라운드 프로세스 중단"""
        if self.process and self.process.poll() is None:
            self.process_running = False
            try:
                self.process.kill()
                self.append_log("\n*** 사용자가 실행을 중단했습니다. ***\n")
                self.stop_manual_activity()
                self.lbl_status.configure(text="중단됨")
            except Exception:
                pass

    # =========================================================================
    # TAB 2: 수동 메일 결과 가시화 및 초기화 로직
    # =========================================================================
    def render_manual_result(self, record):
        """수동 분석 완료된 JSON record 데이터를 우측 카드 뷰에 모던하게 바인딩"""
        self.stop_manual_activity()

        # 1. 위험도 등급 배지 설정
        risk = record.get("riskLevel", "LOW").upper()
        if risk == "HIGH":
            self.lbl_risk_badge.configure(text=f"위험도: {risk}", fg_color=COLOR_RED, text_color="white")
        elif risk == "MEDIUM":
            self.lbl_risk_badge.configure(text=f"위험도: {risk}", fg_color=COLOR_ORANGE, text_color="white")
        else:
            self.lbl_risk_badge.configure(text=f"위험도: {risk}", fg_color=COLOR_GREEN, text_color="white")
            
        # 2. 신뢰도 수치 및 진행바 채우기
        confidence = record.get("confidence", 0)
        self.lbl_confidence.configure(text=f"신뢰도: {confidence}%")
        self.confidence_progress.set(float(confidence) / 100.0)
        
        # 3. 요약 요약문 & 지표 기입
        self.txt_summary.delete("1.0", "end")
        self.txt_summary.insert("1.0", record.get("summary", ""))
        
        self.txt_indicators.delete("1.0", "end")
        indicators = record.get("indicators", [])
        if indicators:
            self.txt_indicators.insert("1.0", "\n".join([f"• {i}" for i in indicators]))
        else:
            self.txt_indicators.insert("1.0", "탐지된 특이 위협 지표가 없습니다.")
            
        # 4. 6대 의심 항목 체크리스트 바인딩
        for child in self.chk_scroll.winfo_children():
            child.destroy()
            
        checklist = record.get("rawResult", {}).get("checklist", [])
        if not checklist:
            checklist = record.get("checklist", [])
            
        if checklist:
            for item in checklist:
                flagged = item.get("flagged", False)
                
                # 체크리스트 개별 카드 프레임
                card = ctk.CTkFrame(self.chk_scroll, fg_color=COLOR_PANEL_SOFT if flagged else COLOR_PANEL_SOFT, corner_radius=8)
                card.pack(fill="x", pady=4, padx=4)
                
                # 의심 상태 플랫 라벨
                badge_bg = COLOR_RED if flagged else COLOR_GREEN
                badge_txt = "의심" if flagged else "정상"
                lbl_badge = ctk.CTkLabel(card, text=badge_txt, font=self.font_badge, text_color="white", fg_color=badge_bg, corner_radius=4, width=44, height=22)
                lbl_badge.pack(side="left", padx=10, pady=8)
                
                # 정보 텍스트 상자
                txt_frame = ctk.CTkFrame(card, fg_color="transparent")
                txt_frame.pack(side="left", fill="both", expand=True, padx=(2, 10), pady=6)
                
                title_color = COLOR_TEXT if flagged else COLOR_MUTED
                lbl_title = ctk.CTkLabel(txt_frame, text=item.get("text", ""), font=ctk.CTkFont(family=self.ui_font_family, size=11, weight="bold"), text_color=title_color, anchor="w")
                lbl_title.pack(fill="x", side="top")
                
                lbl_reason = ctk.CTkLabel(txt_frame, text=item.get("reason", ""), font=ctk.CTkFont(family=self.ui_font_family, size=10), text_color=COLOR_MUTED, anchor="w", justify="left")
                lbl_reason.pack(fill="x", side="top", pady=(2, 0))
        else:
            lbl_no = ctk.CTkLabel(self.chk_scroll, text="체크리스트 정보가 수신되지 않았습니다.", font=self.font_subtitle, text_color=COLOR_MUTED)
            lbl_no.pack(pady=40)
            
        # 5. 디버그 서브탭 내용 주입
        self.txt_sys_prompt.insert("1.0", record.get("systemPrompt", ""))
        self.txt_user_prompt.insert("1.0", record.get("userPrompt", ""))
        self.txt_raw_resp.insert("1.0", record.get("rawResponsePreview", ""))

    def reset_manual_fields(self):
        """수동 입력 창 초기화 및 기본값 복원"""
        self.manual_sender_name.delete(0, "end")
        self.manual_sender_name.insert(0, "홍길동")
        
        self.manual_sender_email.delete(0, "end")
        self.manual_sender_email.insert(0, "gildong@example.com")
        
        self.manual_subject.delete(0, "end")
        self.manual_subject.insert(0, "[긴급] 계정이 일시 정지되었습니다. 본인 인증을 진행해 주세요.")
        
        self.manual_date.delete(0, "end")
        self.manual_date.insert(0, time.strftime("%Y-%m-%d %H:%M:%S"))
        
        self.manual_body.delete("1.0", "end")
        self.manual_body.insert("1.0", "보안 문제로 인해 귀하의 계정이 일시 잠금되었습니다. 아래의 외부 인증 주소를 클릭하여 24시간 내에 본인 인증을 처리하지 않을 경우 계정이 전면 삭제 조치됩니다.\n\nhttp://phishguard-test-fake.com/login")
        
        self.combo_mmodel.set("Gemini 3.1 Flash Lite")
        
        # 우측 카드 초기화
        self.lbl_risk_badge.configure(text="분석 대기", fg_color=COLOR_PANEL_LIFT, text_color=COLOR_MUTED)
        self.lbl_confidence.configure(text="신뢰도: -")
        self.confidence_progress.set(0)
        
        self.txt_summary.delete("1.0", "end")
        self.txt_indicators.delete("1.0", "end")
        
        # 체크리스트 비우기 및 안내 복구
        for child in self.chk_scroll.winfo_children():
            child.destroy()
        self.build_checklist_placeholder()
        
        self.txt_sys_prompt.delete("1.0", "end")
        self.txt_user_prompt.delete("1.0", "end")
        self.txt_raw_resp.delete("1.0", "end")
        self.txt_mlog.delete("1.0", "end")

    # =========================================================================
    # 메인 어플리케이션 소멸 및 윈도우 파괴 처리
    # =========================================================================
    def on_closing(self):
        """창이 닫힐 때 서브 프로세스가 찌꺼기로 남는 것 방지"""
        if self.process and self.process.poll() is None:
            try:
                self.process.kill()
            except Exception:
                pass
        self.destroy()

if __name__ == "__main__":
    # SmokeTest 인자가 들어오면 즉시 검출 출력 후 종료
    if len(sys.argv) > 1 and sys.argv[1] == "-SmokeTest":
        print("Prompt eval desktop GUI smoke test OK")
        sys.exit(0)
        
    app = PhishGuardGUI()
    app.mainloop()
