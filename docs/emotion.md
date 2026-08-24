# 实时面部情绪识别 Web 服务 — 设计文档

> 版本：v1 ｜ 日期：2026-08-21 ｜ 状态：草案

## 1. 背景与目标

基于开源库 [EmotiEffLib](https://github.com/sb-ai-lab/EmotiEffLib)（原 HSEmotion）构建一个可在笔记本上直接运行、无需训练的实时面部情绪识别 Web 服务。

核心诉求：

1. **不训练**，直接使用预训练模型做推理。
2. **笔记本可跑**：目标机器无 NVIDIA GPU、内存仅 ~1.5G 可用、Python 3.13（miniconda）、WSL2 环境。
3. **Web 形态**：Chrome 打开页面，左半屏视频采样、右半屏情绪输出。
4. **情绪更丰富**：不局限于 8 种离散情绪，期望反映情绪的连续/复合特性。

## 2. 现状与约束

| 项 | 现状 | 评估 |
|---|---|---|
| GPU | 无 `nvidia-smi` | 只能 CPU 推理 |
| CPU | Intel Core 5 220H，16 线程 | 充足 |
| 内存 | 7.5G 总，仅 ~1.5G 可用 | 偏紧，需省内存 |
| Python | 3.13.9 | 偏新，PyTorch 兼容性差，优先 ONNX 路线 |
| ffmpeg | 有 | 视频解码无障碍 |

结论：CPU 推理可行，模型须轻量；避免引入 PyTorch 等重依赖。

## 3. 技术选型

### 3.1 情绪识别库：EmotiEffLib

- 核心依赖仅 `numpy / onnx / onnxruntime / opencv-python / pillow`，**无需 PyTorch**（torch 仅用于教程里的 MTCNN 人脸检测，非库本身依赖）。
- 提供 7 个预训练 ONNX 模型，文件 8–39MB，首次运行自动下载（已离线缓存至 `~/.emotiefflib/`）。
- 当前选用 `enet_b0_8_best_vgaf`（16MB，8 类，AffectNet-8 ≈ 61.3%）。
- 8 类标签：Anger / Contempt / Disgust / Fear / Happiness / Neutral / Sadness / Surprise。

### 3.2 人脸检测：OpenCV Haar 级联

- 教程用 `facenet_pytorch.MTCNN`，但依赖 PyTorch，在 Python 3.13 + 内存紧张环境下不划算。
- 改用 `cv2.CascadeClassifier` + `haarcascade_frontalface_default.xml`（cv2 自带，零额外依赖，CPU 极轻）。
- 注意：OpenCV 5.0.0 移除了 `CascadeClassifier`，需固定到 4.x（已安装 `opencv-python==4.11.0.86`）。
- 局限：正面、光线良好时准确；侧脸、多人、昏暗会漏检/误检。后续可升级 YuNet（`cv2.FaceDetectorYN`）或 MediaPipe。

### 3.3 Web 框架：Flask

- 轻量、依赖少。单 `/analyze` POST 接口收 JPEG 帧返回 JSON；`/` 渲染前端页面。
- 加 `Cache-Control: no-cache` 响应头避免浏览器缓存旧页面。

## 4. 系统架构

```
Chrome (Windows)                Flask (WSL2, 127.0.0.1:5000)
┌───────────────────┐           ┌─────────────────────────┐
│ getUserMedia 摄像头 │           │  /analyze               │
│ <video> 实时画面   │  JPEG帧   │   cv2.imdecode           │
│ canvas 抓帧(1fps)  │ ────────> │   Haar 人脸检测          │
│ canvas overlay 框  │           │   emotiefflib ONNX 推理   │
│ 右栏: 情绪日志+比重 │ <──────── │   返回 {faces, probs, ms} │
└───────────────────┘   JSON    └─────────────────────────┘
```

- 采样频率：默认 1 帧/秒（可调 0.5s / 2s），匹配 CPU 推理速度（单帧 ~100–250ms）。
- 内存策略：后端只处理当前帧、不缓存历史帧；前端累积概率而非图像。
- 摄像头：localhost 属安全上下文，`getUserMedia` 可直接用；启动 Chrome 时加 `--use-fake-ui-for-media-stream` 自动允许权限。
- 已知坑：Lenovo 笔记本摄像头有物理/系统级禁用（隐私快门、Fn 键、Vantage 隐私模式），浏览器与命令行均无法绕过，须用户在硬件/系统层开启。

## 5. 情绪模型分析

### 5.1 两种情绪理论框架

| 框架 | 含义 | 当前 | 丰富度 |
|---|---|---|---|
| 离散模型（Ekman） | 6–8 种基本情绪 | ✅ 在用 | 低，复合情绪表达不出 |
| 维度模型（Russell 环状） | valence（消极↔积极）× arousal（平静↔激动）连续平面 | ❌ | 高，连续无穷状态 |

四象限对应：右上=兴奋、右下=满足平静、左上=紧张愤怒恐惧、左下=沮丧悲伤。同一「快乐」可区分「兴奋的快乐」与「平静的满足」，正是离散 8 类做不到的。

### 5.2 EmotiEffLib 内部升级（零成本）

- `enet_b2_8`：30MB，AffectNet-8 ≈ 63%（+1.5），纯 8 类。
- **`enet_b0_8_va_mtl`**：16MB，额外输出 valence/arousal 连续维度（`classify_emotions` 返回 `scores` 末 2 列）。同 pipeline、CPU 可跑、无新依赖。**最对症的「更丰富」低成本升级。**

### 5.3 SOTA 模型对比（2026）

| 模型 | 输出 | AffectNet VA RMSE (V/A) | 8 类 ACC | 需 GPU | 权重 |
|---|---|---|---|---|---|
| EmotiEffLib b0（现用） | 8 类（va_mtl 可加 VA） | 未优化 | 61.3% | 否 | 有 |
| EmotiEffLib `enet_b0_8_va_mtl` | 8 类 + VA | 未优化 | ~61% | 否 | 有 |
| **CAGE**（推荐-GPU） | VA 连续（环状原生） | **0.331/0.305** | — | 是 | 有 |
| EmoNet（备选-GPU） | 8 类 + VA + 关键点 | 0.29/0.27 | 0.75 | 是 | 有 |
| ExpressNet-MoE | 8 类离散 | — | 71.98% | 是 | 有 |
| FER-EMFormer | 8 类离散 | — | 70.43% | 是 | 有 |

- CAGE：[CVPR2024W 论文](https://openaccess.thecvf.com/content/CVPR2024W/ABAW/papers/Wagner_CAGE_Circumplex_Affect_Guided_Expression_Inference_CVPRW_2024_paper.pdf) / [arXiv](https://doi.org/10.48550/arxiv.2404.14975) / [代码](https://github.com/wagner-niklas/CAGE_expression_inference)，MaxViT 轻量，为环状连续模型而生。
- EmoNet：[代码](https://github.com/face-analysis/emonet)，一个模型同时输出离散+连续+关键点，部署最省事。
- ExpressNet-MoE / FER-EMFormer：纯离散 8 类 SOTA，与「更丰富」目标相反。

## 6. 升级路线

### 阶段一（当前，无 GPU）：丰富输出

1. 后端 `model_name` 改为 `enet_b0_8_va_mtl`，`/analyze` 返回 `probs`（8 类）+ `valence` + `arousal`。
2. 前端新增 **valence-arousal 二维散点轨迹图**：每帧打点、连成轨迹，直观显示情绪在连续空间的滑动。
3. 给当前点一个**象限描述**（兴奋区/满足区/紧张区/低落区）。
4. 保留现有「每帧 top-3 情绪 + 累积比重（前 3）」。

### 阶段二（无 GPU，互补）：细粒度动作单元

- 引入 [MediaPipe FaceLandmarker](https://developers.google.com/edge/mediapipe/solutions/vision/face_landmarker)：478 个 3D 关键点 + 52 个 ARKit blendshape（AU 近似）。
- 派生：微笑程度、皱眉、眨眼、专注度/疲劳（PERCLOS、眨眼率）。
- CPU 友好、无 torch，作为维度模型之外的另一层细节。

### 阶段三（有 GPU）：换 SOTA 连续模型

- 替换后端推理为 **CAGE**（首选）或 **EmoNet**（备选）。
- 仍需配人脸检测器（可升级 YuNet / MediaPipe）。
- 前端 VA 轨迹图无需大改，仅数据源切换。
- 若转而追求 8 类最高准确率（非丰富目标）：ExpressNet-MoE / FER-EMFormer。

### 可选：浏览器端推理（推荐用于当前机器）

- 参考 [Arjun10g/live-expression-reader](https://github.com/Arjun10g/live-expression-reader)：`onnxruntime-web` + HSEmotion ONNX + MediaPipe，画面不离开浏览器、无需 Python 后端。
- **对本机的关键意义**：WSL 仅剩 ~1.5G 内存，把推理从 WSL 后端挪到 Windows 浏览器，彻底绕开内存瓶颈；浏览器端还可用 WebGPU/WASM 加速。

#### 运行时选择澄清

模型丰富度由 ONNX 文件本身决定，与运行时无关。同一个 `enet_b0_8_va_mtl.onnx`（8 类 + valence/arousal）在 Python / Node.js / 浏览器中均可加载。不同运行时的差异在于资源占用与加速：

| 运行时 | 推理位置 | WSL 内存占用 | 加速 | 评价 |
|---|---|---|---|---|
| Python + onnxruntime（现用） | WSL 后端 | 占用 | CPU | 当前方案 |
| Node.js + onnxruntime-node | WSL 后端 | 仍占用 | CPU | 仅替换 Flask，无实质收益 |
| **浏览器 + onnxruntime-web** | Windows Chrome | **不占用** | WebGPU/WASM | **推荐**：省内存瓶颈 |

> 结论：换 Node.js 后端不会解锁更丰富的模型；真正的架构改善是把推理挪到浏览器端（onnxruntime-web），用 Windows Chrome 的资源，释放 WSL 的 1.5G 内存，并复用同一个 `enet_b0_8_va_mtl.onnx`。

#### 浏览器端技术栈草案

- 人脸检测：[`@mediapipe/tasks-vision`](https://www.npmjs.com/package/@mediapipe/tasks-vision) FaceLandmarker / FaceDetector（JS，浏览器原生）。
- 情绪推理：`onnxruntime-web` 加载 `enet_b0_8_va_mtl.onnx`（16MB，静态托管）。
- 后端：可降级为纯静态文件服务（甚至无需 Node），或保留一个极轻 Node 服务仅做静态托管。
- 输出：8 类概率 + valence/arousal，前端 VA 二维轨迹图。

## 7. 当前实现细节

### 7.1 文件结构

```
/home/yong/workspace/github/emotion/
├── app.py                 # Flask 后端：Haar 检测 + emotiefflib ONNX 推理
├── templates/index.html   # 前端：双栏布局，摄像头采样 + 情绪日志
└── docs/                  # 文档目录
    └── design.md           # 本设计文档
```

### 7.2 后端 `/analyze` 响应

```json
{
  "faces": [
    {
      "box": [x, y, w, h],
      "emotion": "Happiness",
      "score": 0.621,
      "probs": [0.038, 0.026, 0.026, 0.238, 0.103, 0.247, 0.106, 0.213]
    }
  ],
  "ms": 896.2
}
```

### 7.3 前端功能

- 左栏：摄像头实时画面 + 绿色人脸框 + 框上情绪标签（中文）。
- 右栏：每帧 top-3 情绪日志行（时间 / 前 3 情绪及占比 / 耗时）。
- 下方累积比重条：跨帧概率求和归一，显示前 3 情绪占比（中文）。
- 控制：启动/停止摄像头、采样间隔（0.5/1/2s）、清除日志。

## 8. 风险与待办

| 项 | 说明 | 缓解 |
|---|---|---|
| 内存紧张 | 仅 ~1.5G 可用 | 不缓存历史帧；必要时转浏览器端推理 |
| Haar 检测精度 | 侧脸/昏暗漏检 | 升级 YuNet / MediaPipe |
| 摄像头系统级禁用 | Lenovo 隐私快门/Fn/Vantage | 用户硬件层开启，文档提示 |
| Python 3.13 兼容 | torch 类依赖风险 | 坚持 ONNX 路线 |
| OpenCV 5.0 移除 CascadeClassifier | 已踩坑 | 固定 opencv-python 4.x |
| 模型下载网络不稳 | github 大文件拉取慢 | 已离线拷贝至 `~/.emotiefflib/` |

## 9. 最丰富模型对比与 OpenFace 集成路线

### 9.1 丰富度维度

情绪输出的丰富度包含：离散表情类别、连续 valence-arousal、面部动作单元 AU（带强度）、复合表情、不确定性估计、头姿/视线/关键点等辅助信号。

### 9.2 开源模型丰富度排名

| 模型 | 离散 | 连续VA | AU | 不确定性 | 需GPU | 本机可测 |
|---|---|---|---|---|---|---|
| **AffectFlow-DINO**（11th ABAW 2026 MTL） | 8 类 | ✅ | 12 个 | ✅ | 是 | ❌ 无GPU |
| AffectFuse / HSEmotion ABAW-11 | 8 类 | ✅ | 12 个 | — | 是 | ❌ |
| [EmoNet](https://github.com/face-analysis/emonet) | 8 类 | ✅ | 关键点 | — | 是 | ❌ |
| [CAGE](https://github.com/wagner-niklas/CAGE_expression_inference) | — | ✅ | — | — | 是 | ❌ |
| **[OpenFace 2.0/3.0](https://github.com/TadasBaltrusaitis/OpenFace)** | 3.0加情绪 | — | **17–18 个(强度0–5)** | — | **否(CPU)** | ✅ |
| [MediaPipe FaceLandmarker](https://developers.google.com/edge/mediapipe/solutions/vision/face_landmarker) | — | — | 52 blendshape | — | 否(浏览器) | ✅ |
| 本机现用 `enet_b0_8_va_mtl` | 8 类 | ✅ | — | — | 否 | ✅(已跑) |

- **最丰富开源单模型 = AffectFlow-DINO**：[GitHub](https://github.com/Bekhouche/AffectFlow-DINO) + [HuggingFace 权重](https://huggingface.co/Bekhouche/AffectFlow-DINO)，一次推理同时输出 VA + 8 类 + 12 AU + 不确定性；但基于 DINOv3 ViT-S/16，需 GPU + PyTorch。
- **本机无 GPU 可测的最丰富 = OpenFace**：17–18 个 AU 的存在 + 强度（0–5 连续）+ 68 关键点 + 头姿 + 视线；[OpenFace 3.0 (2025)](https://arxiv.org/pdf/2506.02891) 新增情绪识别，统一多任务模型；CPU 实时、开源成熟。AU 是 FACS 解剖学标准，可经规则映射出任意复合表情。
- **浏览器最轻丰富 = MediaPipe blendshapes**：52 个 ARKit blendshape + 478 关键点，浏览器原生、零后端；解剖精度低于 OpenFace AU，可经 PLS 映射到 ~20 个 FACS AU。

### 9.3 OpenFace 集成路线（本机实测不可行 → 改用 MediaPipe）

**实测结论**：OpenFace 路线在本机不可行。
- **LibreFace**（OpenFace 的 Python 重实现，`pip install libreface`）依赖 `torch==2.0.0` + `dlib` + `mediapipe==0.10.5`；torch 2.0 在 Python 3.13 上无法安装，且内存吃紧。
- **OpenFace C++ 原版**需从源码编译（OpenCV/dlib/CMake），本机仅剩 ~1.5G 内存，编译大概率失败或极慢。

**本机可行的 AU 丰富度来源 = MediaPipe blendshapes（浏览器端）**：
- [`@mediapipe/tasks-vision`](https://www.npmjs.com/package/@mediapipe/tasks-vision) FaceLandmarker，输出 478 关键点 + 52 个 ARKit blendshape。
- 浏览器原生 JS，无 torch、无编译，用 Windows Chrome 资源，不占 WSL 内存。
- 52 blendshape 可经 PLS 回归映射到 ~20 个 FACS AU，获得近似 AU 强度。
- 与 EmotiEffLib 的 VA 互补：MediaPipe 给 AU 细节，EmotiEffLib 给 VA 连续值。

**集成方式（浏览器端）**：
1. 前端用 MediaPipe 提取 52 blendshape，本地映射为 AU 强度，渲染 17 条 AU 强度条形图。
2. 后端（或浏览器端 onnxruntime-web）继续用 `enet_b0_8_va_mtl` 提供 8 类 + VA。
3. 两路在前端并列展示：AU 条形图 + VA 轨迹图 + 8 类概率。

> 注：若未来有 GPU 机器，可直接上 AffectFlow-DINO（VA + 8 类 + 12 AU + 不确定性一次出齐），无需拼接。

## 10. 结论

- **当前阶段**：EmotiEffLib ONNX + Haar + Flask 已可在目标笔记本 CPU 上实时运行，满足「不训练、直接用、Web 形态」。
- **「更丰富」第一步**：切换 `enet_b0_8_va_mtl` + 前端 VA 二维轨迹图，零新依赖、CPU 可跑，最对症。
- **当前机器的架构优化**：换 Node.js 后端无实质收益；推荐改用**浏览器端 `onnxruntime-web`** 推理，复用同一 `enet_b0_8_va_mtl.onnx`，释放 WSL 仅剩的 1.5G 内存，并获 WebGPU/WASM 加速。
- **本机可测的最丰富**：MediaPipe blendshapes（浏览器端，52 blendshape 映射 ~20 AU）与 EmotiEffLib 的 VA 互补；OpenFace/LibreFace 因 torch/编译约束在本机不可行。
- **有 GPU 后**：采用 AffectFlow-DINO（VA + 8 类 + 12 AU + 不确定性，当前最丰富）或 CAGE（VA SOTA）替换推理后端，前端轨迹图复用。
- **追求 8 类最准**（非本目标）：ExpressNet-MoE / FER-EMFormer。
