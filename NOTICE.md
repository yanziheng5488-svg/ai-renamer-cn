# 版权与来源声明 / NOTICE

## 本项目

**智名 · AI 文件重命名**（仓库内名称 `ai-renamer-cn`）
Copyright (C) 2026 智名项目贡献者

以 **GNU General Public License v3.0** 发布，全文见 [LICENSE](LICENSE)。

## 上游项目

本项目是下列项目的衍生作品：

- **ai-renamer**
- 作者：Ozgur Ozer（ozgrozer）
- 仓库：https://github.com/ozgrozer/ai-renamer
- 许可证：GPL-3.0
- Copyright (C) 2024 Ozgur Ozer

## 修改说明

依据 GPL-3.0 第 5(a) 条，在此声明本项目对上游作品的修改：

- **修改时间**：2026 年 10 月
- **修改性质**：以上游项目的整体思路与处理流程为基础重写，新增图形界面，
  改为面向中文用户，并替换了命名规范化、模型接入、文档解析等核心模块。
- **未沿用**：上游的 CLI 入口与命令行参数、`change-case` 命名方案、
  英文提示词、串行处理逻辑。界面层为全新实现。

模块对应关系（便于对照上游实现）：

| 本项目 | 上游对应 | 改动程度 |
|---|---|---|
| `lib/renamer.js` | `processPath.js` / `processFile.js` / `processDirectory.js` | 重构为并发任务调度 + 两阶段改名 + 撤销 |
| `lib/providers.js` | `getModelResponse.js` / `chooseModel.js` | 改用内置 fetch；增加 10 家国产厂商；错误信息中文化 |
| `lib/frames.js` | `extractFrames.js` | 改为按时间中点逐帧 seek；修复临时目录与短视频除零问题 |
| `lib/namer.js` | `getNewName.js` / `changeCase.js` | 完全重写，替换掉对中文无效的 change-case |
| `lib/prompt.js` | `getNewName.js` 内联提示词 | 重写为中文提示词 |
| `lib/readers.js` | `readFileContent.js` | 增加编码嗅探、docx / xlsx 支持 |
| `lib/scanner.js` | `supportedExtensions.js` / `isImage.js` / `isVideo.js` | 重写为按类别分组的文件扫描 |
| `main.js` / `preload.js` / `renderer/` | 无（上游为 CLI） | 全新实现 |

## 上游许可证完整继承

依据 GPL-3.0，本项目整体（含新增部分）同样以 GPL-3.0 发布。
任何人分发本项目的修改版本时，须同样遵守 GPL-3.0，包括：

1. 保留本声明与 [LICENSE](LICENSE) 全文；
2. 显著标明自己做了修改及修改日期；
3. 向接收者提供完整的对应源代码。

## 名称与标识

本项目的名称「智名」、图标与界面设计为独立创作，
**与原作者的名称、商标、项目标识无关**，也不表示原作者对本项目的认可或背书。
请勿使用原作者姓名或 `ai-renamer` 名义宣传本项目。

---

# Notice (English)

**ZhiMing / ai-renamer-cn** is a derivative work of
[ai-renamer](https://github.com/ozgrozer/ai-renamer) by Ozgur Ozer, licensed under GPL-3.0.

Modifications were made in October 2026: the project was reimplemented with a desktop GUI,
a Chinese-first naming engine, a new provider layer (10 Chinese LLM vendors), and new
document parsers. See the table above for the module mapping.

This program is free software: you can redistribute it and/or modify it under the terms of
the GNU General Public License as published by the Free Software Foundation, **version 3**
of the License. It is distributed in the hope that it will be useful, but WITHOUT ANY
WARRANTY; without even the implied warranty of MERCHANTABILITY or FITNESS FOR A PARTICULAR
PURPOSE. See the GNU General Public License for more details.

The upstream project does not state an "or any later version" clause, so this derivative
work is distributed under GPL-3.0 only.

The names and marks of the upstream author and project are not used to endorse this work.
