#!/usr/bin/env ruby

require "digest"
require "json"
require "time"
require "unicode_normalize/normalize"

ROOT = File.expand_path("..", __dir__)
PUBLIC_TESTS_PATH = File.join(ROOT, "data", "tests-public.js")
SECRET_KEYS_PATH = File.join(ROOT, "private-data", "tests-answer-keys.secret.json")
OUTPUT_PATH = File.join(ROOT, "data", "tests-score-hashes.js")

def normalize_answer(value)
  normalized = value.to_s
                    .unicode_normalize(:nfkc)
                    .strip
                    .downcase
                    .tr("ё", "е")
                    .gsub(/\s+/, " ")
  normalized.match?(/\A[\d\s,;.]+\z/) ? normalized.gsub(/\D/, "") : normalized
end

def answer_hash(value)
  Digest::SHA256.hexdigest(normalize_answer(value))
end

public_source = File.read(PUBLIC_TESTS_PATH)
public_json = public_source.sub(/\A.*?=\s*/m, "").sub(/;\s*\z/, "")
public_data = JSON.parse(public_json)
secret_data = JSON.parse(File.read(SECRET_KEYS_PATH))

question_types = public_data.fetch("tests").each_with_object({}) do |test, types|
  test.fetch("questions").each { |question| types[question.fetch("id")] = question.fetch("type") }
end

tests = secret_data.fetch("tests").each_with_object({}) do |test, output|
  answers = test.fetch("answers").each_with_object({}) do |answer, keyed_answers|
    next if answer["missingKey"] || answer.fetch("acceptedAnswers", []).empty?

    keyed_answers[answer.fetch("questionId")] = {
      "type" => question_types.fetch(answer.fetch("questionId")),
      "points" => answer["points"].to_i,
      "hashes" => answer.fetch("acceptedAnswers").map { |value| answer_hash(value) }.uniq.sort,
      "acceptedAnswers" => answer.fetch("acceptedAnswers").map(&:to_s).uniq
    }
  end

  output[test.fetch("id")] = {
    "gradablePoints" => answers.values.sum { |answer| answer.fetch("points") },
    "answers" => answers
  }
end

payload = {
  "schemaVersion" => 1,
  "generatedAt" => Time.now.utc.iso8601,
  "normalization" => "nfkc-trim-lowercase-yo-whitespace",
  "tests" => tests
}

File.write(OUTPUT_PATH, "// Generated scoring data. Correct answers are revealed by the interface after submission.\nwindow.EGE_TEST_SCORE_HASHES = #{JSON.pretty_generate(payload)};\n")
puts "Generated #{OUTPUT_PATH} with #{tests.length} tests."
