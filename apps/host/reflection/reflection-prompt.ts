export const reflectionOutputGuidance = `用简体中文保存简短结论，不写审查过程或长篇复述。
summary：1–2 句，直接说明结论；没有证据支持的新发现时写“本次没有新增发现”。
findings：仅列证据支持、值得保留的新发现，每项一句；没有则 []。
uncertainties：只列影响结论且仍未确认的事项，每项一句；没有则 []。
evidence：引用实际读取的证据，不编造来源。已有认识不等于本次新增发现。
不为填满字段而生成问题、知识更新或建议；没有新增发现、不修改 Memory、不提交建议都是有效结果。
示例（仅说明格式，不是本次事实）：{"summary":"本次没有新增发现。","findings":[],"uncertainties":[],"evidence":[]}。`;
