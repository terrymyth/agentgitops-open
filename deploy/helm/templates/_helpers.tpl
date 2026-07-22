{{/*
Common labels
*/}}
{{- define "agentgitops.labels" -}}
app.kubernetes.io/name: agentgitops
app.kubernetes.io/instance: {{ .Release.Name }}
app.kubernetes.io/version: {{ .Chart.AppVersion | quote }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
helm.sh/chart: {{ .Chart.Name }}-{{ .Chart.Version }}
{{- end -}}

{{/*
Selector labels
*/}}
{{- define "agentgitops.selectorLabels" -}}
app.kubernetes.io/name: agentgitops
app.kubernetes.io/instance: {{ .Release.Name }}
{{- end -}}
