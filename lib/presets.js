'use strict'

/**
 * 国产大模型服务商预置表
 *
 * 设计说明：
 * 国内主流厂商几乎都提供 OpenAI 兼容接口（/v1/chat/completions），
 * 所以一套调用逻辑就能全部支持，差别只在 baseURL、模型名和 Key 的申请地址。
 *
 * 字段：
 *   id         内部标识
 *   name       界面上显示的名字
 *   vendor     厂商
 *   baseURL    接口地址（已包含 /v1 的部分，调用时拼 /chat/completions）
 *   protocol   'openai' | 'ollama'
 *   vision     是否支持看图（决定图片/视频任务是否可用）
 *   models     预置模型（按推荐度排序，第一个为默认）
 *   keyUrl     申请 Key 的地址
 *   note       界面上的提示
 */

const PRESETS = [
  {
    id: 'qwen',
    name: '通义千问',
    vendor: '阿里云百炼',
    protocol: 'openai',
    baseURL: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    vision: true,
    models: [
      { name: 'qwen-vl-max', vision: true, label: 'qwen-vl-max · 看图最准' },
      { name: 'qwen2.5-vl-72b-instruct', vision: true, label: 'qwen2.5-vl-72b · 看图' },
      { name: 'qwen-vl-plus', vision: true, label: 'qwen-vl-plus · 看图（便宜）' },
      { name: 'qwen-plus', vision: false, label: 'qwen-plus · 只读文字' },
      { name: 'qwen-turbo', vision: false, label: 'qwen-turbo · 只读文字（快）' }
    ],
    keyUrl: 'https://bailian.console.aliyun.com/?apiKey=1',
    note: '新用户有免费额度。图片用 qwen-vl 系列，文字用 qwen-plus。'
  },
  {
    id: 'zhipu',
    name: '智谱 GLM',
    vendor: '智谱 AI',
    protocol: 'openai',
    baseURL: 'https://open.bigmodel.cn/api/paas/v4',
    vision: true,
    models: [
      { name: 'glm-4v-flash', vision: true, label: 'glm-4v-flash · 看图（完全免费）' },
      { name: 'glm-4.5v', vision: true, label: 'glm-4.5v · 看图（效果最好）' },
      { name: 'glm-4v-plus-0111', vision: true, label: 'glm-4v-plus · 看图' },
      { name: 'glm-4-flash', vision: false, label: 'glm-4-flash · 只读文字（免费）' },
      { name: 'glm-4-plus', vision: false, label: 'glm-4-plus · 只读文字' }
    ],
    keyUrl: 'https://bigmodel.cn/usercenter/proj-mgmt/apikeys',
    note: 'glm-4v-flash 和 glm-4-flash 免费，适合先试用，不花钱就能跑通。'
  },
  {
    id: 'siliconflow',
    name: '硅基流动',
    vendor: 'SiliconFlow',
    protocol: 'openai',
    baseURL: 'https://api.siliconflow.cn/v1',
    vision: true,
    models: [
      { name: 'Qwen/Qwen2.5-VL-72B-Instruct', vision: true, label: 'Qwen2.5-VL-72B · 看图' },
      { name: 'Qwen/Qwen2.5-VL-32B-Instruct', vision: true, label: 'Qwen2.5-VL-32B · 看图' },
      { name: 'THUDM/GLM-4.1V-9B-Thinking', vision: true, label: 'GLM-4.1V-9B · 看图（免费）' },
      { name: 'deepseek-ai/DeepSeek-V3', vision: false, label: 'DeepSeek-V3 · 只读文字' },
      { name: 'Qwen/Qwen2.5-7B-Instruct', vision: false, label: 'Qwen2.5-7B · 只读文字（免费）' }
    ],
    keyUrl: 'https://cloud.siliconflow.cn/account/ak',
    note: '一个 Key 能调用几十种模型，适合想多试几个模型的用户。'
  },
  {
    id: 'deepseek',
    name: 'DeepSeek',
    vendor: '深度求索',
    protocol: 'openai',
    baseURL: 'https://api.deepseek.com/v1',
    vision: false,
    models: [
      { name: 'deepseek-chat', vision: false, label: 'deepseek-chat · 只读文字' },
      { name: 'deepseek-reasoner', vision: false, label: 'deepseek-reasoner · 只读文字（推理）' }
    ],
    keyUrl: 'https://platform.deepseek.com/api_keys',
    note: '暂无视觉模型，无法处理图片和视频；适合给 txt、md、pdf、代码文件命名。'
  },
  {
    id: 'moonshot',
    name: 'Kimi',
    vendor: '月之暗面',
    protocol: 'openai',
    baseURL: 'https://api.moonshot.cn/v1',
    vision: true,
    models: [
      { name: 'moonshot-v1-8k-vision-preview', vision: true, label: 'moonshot-v1-8k-vision · 看图' },
      { name: 'moonshot-v1-32k-vision-preview', vision: true, label: 'moonshot-v1-32k-vision · 看图（长文本）' },
      { name: 'moonshot-v1-8k', vision: false, label: 'moonshot-v1-8k · 只读文字' }
    ],
    keyUrl: 'https://platform.moonshot.cn/console/api-keys',
    note: '视觉模型需要单独开通，控制台里确认一下权限。'
  },
  {
    id: 'volcengine',
    name: '豆包',
    vendor: '火山引擎方舟',
    protocol: 'openai',
    baseURL: 'https://ark.cn-beijing.volces.com/api/v3',
    vision: true,
    models: [
      { name: 'doubao-1.5-vision-pro-32k', vision: true, label: 'doubao-1.5-vision-pro · 看图' },
      { name: 'doubao-vision-lite-32k', vision: true, label: 'doubao-vision-lite · 看图（便宜）' },
      { name: 'doubao-pro-32k', vision: false, label: 'doubao-pro-32k · 只读文字' }
    ],
    keyUrl: 'https://console.volcengine.com/ark/region:ark+cn-beijing/apiKey',
    note: '若提示模型不存在，请在方舟控制台「在线推理」里创建接入点，把接入点 ID（ep- 开头）填到模型框。'
  },
  {
    id: 'hunyuan',
    name: '腾讯混元',
    vendor: '腾讯云',
    protocol: 'openai',
    baseURL: 'https://api.hunyuan.cloud.tencent.com/v1',
    vision: true,
    models: [
      { name: 'hunyuan-vision', vision: true, label: 'hunyuan-vision · 看图' },
      { name: 'hunyuan-turbos-vision', vision: true, label: 'hunyuan-turbos-vision · 看图（快）' },
      { name: 'hunyuan-turbos-latest', vision: false, label: 'hunyuan-turbos · 只读文字' }
    ],
    keyUrl: 'https://console.cloud.tencent.com/hunyuan/api-key',
    note: '需要用「API Key」而不是腾讯云的 SecretId/SecretKey。'
  },
  {
    id: 'qianfan',
    name: '文心一言',
    vendor: '百度千帆',
    protocol: 'openai',
    baseURL: 'https://qianfan.baidubce.com/v2',
    vision: true,
    models: [
      { name: 'ernie-4.5-turbo-vl', vision: true, label: 'ERNIE-4.5-Turbo-VL · 看图' },
      { name: 'ernie-4.5-turbo-128k', vision: false, label: 'ERNIE-4.5-Turbo · 只读文字' },
      { name: 'ernie-speed-128k', vision: false, label: 'ERNIE-Speed · 只读文字（免费）' }
    ],
    keyUrl: 'https://console.bce.baidu.com/iam/#/iam/apikey/list',
    note: '在千帆控制台创建应用后获取 API Key，使用 v2 版本的兼容接口。'
  },
  {
    id: 'minimax',
    name: 'MiniMax',
    vendor: 'MiniMax',
    protocol: 'openai',
    baseURL: 'https://api.minimax.chat/v1',
    vision: true,
    models: [
      { name: 'MiniMax-VL-01', vision: true, label: 'MiniMax-VL-01 · 看图' },
      { name: 'MiniMax-Text-01', vision: false, label: 'MiniMax-Text-01 · 只读文字' }
    ],
    keyUrl: 'https://platform.minimaxi.com/user-center/basic-information/interface-key',
    note: ''
  },
  {
    id: 'stepfun',
    name: '阶跃星辰',
    vendor: 'StepFun',
    protocol: 'openai',
    baseURL: 'https://api.stepfun.com/v1',
    vision: true,
    models: [
      { name: 'step-1o-turbo-vision', vision: true, label: 'step-1o-turbo-vision · 看图' },
      { name: 'step-1v-8k', vision: true, label: 'step-1v-8k · 看图' },
      { name: 'step-2-16k', vision: false, label: 'step-2-16k · 只读文字' }
    ],
    keyUrl: 'https://platform.stepfun.com/interface-key',
    note: ''
  },
  {
    id: 'ollama',
    name: 'Ollama（本地）',
    vendor: '本机运行',
    protocol: 'ollama',
    baseURL: 'http://127.0.0.1:11434',
    vision: true,
    models: [
      { name: 'qwen2.5vl:7b', vision: true, label: 'qwen2.5vl:7b · 看图（推荐）' },
      { name: 'qwen2.5vl:3b', vision: true, label: 'qwen2.5vl:3b · 看图（轻量）' },
      { name: 'minicpm-v', vision: true, label: 'minicpm-v:8b · 看图（中文好）' },
      { name: 'qwen2.5:7b', vision: false, label: 'qwen2.5:7b · 只读文字' },
      { name: 'glm4:9b', vision: false, label: 'glm4:9b · 只读文字' }
    ],
    keyUrl: 'https://ollama.com/download',
    note: '完全免费、断网可用、文件不外传。装好 Ollama 后执行 ollama pull qwen2.5vl:7b。'
  },
  {
    id: 'lmstudio',
    name: 'LM Studio（本地）',
    vendor: '本机运行',
    protocol: 'openai',
    baseURL: 'http://127.0.0.1:1234/v1',
    vision: true,
    models: [
      { name: 'qwen2.5-vl-7b-instruct', vision: true, label: 'qwen2.5-vl-7b · 看图' },
      { name: 'minicpm-v-2_6', vision: true, label: 'minicpm-v-2.6 · 看图（中文好）' }
    ],
    keyUrl: 'https://lmstudio.ai/',
    note: '在 LM Studio 里启动本地服务器（默认 1234 端口），模型名填界面上显示的即可。'
  },
  {
    id: 'custom',
    name: '自定义接口',
    vendor: '任意 OpenAI 兼容服务',
    protocol: 'openai',
    baseURL: '',
    vision: true,
    models: [],
    keyUrl: '',
    note: '任何兼容 /v1/chat/completions 的服务都能接，比如自建 vLLM、OneAPI、FastGPT 网关。'
  }
]

const findPreset = id => PRESETS.find(p => p.id === id) || PRESETS[0]

/** 该厂商是否有能看图的模型 */
const supportsVision = presetId => {
  const p = findPreset(presetId)
  return p.vision || p.models.some(m => m.vision)
}

module.exports = { PRESETS, findPreset, supportsVision }
