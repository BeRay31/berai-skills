#!/bin/bash

find_all_pipelines() {
    local root_pipeline_id="$1"
    local pipeline_queue=("$root_pipeline_id")
    local all_pipelines=("$root_pipeline_id")

    while [ ${#pipeline_queue[@]} -gt 0 ]; do
        local pipeline_id="${pipeline_queue[0]}"
        pipeline_queue=("${pipeline_queue[@]:1}")

        local child_pipelines=$(glab api "projects/:fullpath/pipelines/$pipeline_id/bridges" | \
            jq -r '.[] | .downstream_pipeline.id // empty')

        for child_id in $child_pipelines; do
            all_pipelines+=("$child_id")
            pipeline_queue+=("$child_id")
        done
    done

    echo "${all_pipelines[@]}"
}

find_failed_jobs() {
    local pipeline_ids=($@)

    for pipeline_id in "${pipeline_ids[@]}"; do
        local failed_jobs=$(glab api "projects/:fullpath/pipelines/$pipeline_id/jobs?scope[]=failed" --paginate | \
            jq -r '.[] | select(.allow_failure == false) | .id')

        if [ -n "$failed_jobs" ]; then
            echo "$failed_jobs"
        fi
    done
}

mr_id="$1"

mr_data=$(glab mr view "$mr_id" --output json)
pipeline_id=$(echo "$mr_data" | jq -r '.head_pipeline.id // .pipeline.id // empty')

if [ -z "$pipeline_id" ]; then
    echo "Error: Could not find pipeline for MR $mr_id" >&2
    exit 1
fi

pipelines=$(find_all_pipelines "$pipeline_id")
find_failed_jobs $pipelines
