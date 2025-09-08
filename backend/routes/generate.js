const express = require('express');
const axios = require('axios');
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const router = express.Router();

// Remove previously generated transient artifacts to keep repo clean
function cleanupOldFiles() {
  try {
    const videosDir = path.join(__dirname, '..', 'videos');
    const tempDir = path.join(__dirname, '..', 'temp');
    
    // Clean up old generated videos (keep only dummy and fallback)
    if (fs.existsSync(videosDir)) {
      const files = fs.readdirSync(videosDir);
      files.forEach(file => {
        if (file.startsWith('lecture_') && file.endsWith('.mp4')) {
          const filePath = path.join(videosDir, file);
          fs.unlinkSync(filePath);
          console.log('Cleaned up old video:', file);
        }
      });
    }
    
    // Clean up temp directory
    if (fs.existsSync(tempDir)) {
      const files = fs.readdirSync(tempDir);
      files.forEach(file => {
        const filePath = path.join(tempDir, file);
        try {
          if (file.startsWith('lecture_') && file.endsWith('.py')) {
            fs.unlinkSync(filePath);
            console.log('Cleaned up old Python file:', file);
          } else if (file === '__pycache__' || file === 'media') {
            fs.rmSync(filePath, { recursive: true, force: true });
            console.log('Cleaned up directory:', file);
          }
        } catch (e) {
          if (e && e.code === 'EBUSY') {
            // Ignore locked files on Windows; they'll be cleaned later
          } else {
            throw e;
          }
        }
      });
    }
    
  // Silenced verbose log
  } catch (error) {
    console.error('Error during cleanup:', error.message);
  }
}

// Generate lecture endpoint
router.post('/', async (req, res) => {
  try {
    const { prompt } = req.body;
    
    if (!prompt) {
      return res.status(400).json({ error: 'Prompt is required' });
    }

    // Basic guardrails
    if (prompt.length > 1200) {
      return res.status(413).json({ error: 'Prompt too long (max 1200 chars)' });
    }
    if (/import\s+os|subprocess|open\(|exec\(|eval\(/i.test(prompt)) {
      return res.status(400).json({ error: 'Prompt contains disallowed patterns' });
    }
    
    // Clean up old files before generating new content
    cleanupOldFiles();

    // Step 1: Generate Manim code and narration using LLM
    const llmResponse = await generateContent(prompt);
    
    // Step 2: Execute Manim code to create animation
    const videoPath = await executeManimCode(llmResponse.manimCode);
    
    // Step 3: TTS will be handled by browser on frontend
    
    res.json({
      success: true,
      videoUrl: `/videos/${path.basename(videoPath)}`,
      narration: llmResponse.narration,
      manimCode: llmResponse.manimCode,
      title: llmResponse.title || "Generated Lecture",
      totalDuration: llmResponse.totalDuration || 90,
      scenes: llmResponse.scenes || [] // Include scenes for debugging/frontend use
    });

  } catch (error) {
    console.error('Error generating lecture:', error);
    res.status(500).json({ error: 'Failed to generate lecture', details: error.message });
  }
});

// Function to generate fallback Manim code
function generateFallbackManimCode() {
  return `from manim import *

class LectureScene(Scene):
    def construct(self):
        # Title
        title = Text("Educational Content", font_size=48, color=BLUE)
        self.play(Write(title))
        self.wait(1)
        
        # Move title up
        self.play(title.animate.to_edge(UP))
        
        # Content boxes
        box1 = Rectangle(width=3, height=1, color=GREEN, fill_opacity=0.3)
        box2 = Rectangle(width=3, height=1, color=RED, fill_opacity=0.3)
        box3 = Rectangle(width=3, height=1, color=YELLOW, fill_opacity=0.3)
        
        box1.move_to(UP * 1)
        box2.move_to(ORIGIN)
        box3.move_to(DOWN * 1)
        
        text1 = Text("Concept 1", font_size=24).move_to(box1)
        text2 = Text("Concept 2", font_size=24).move_to(box2)
        text3 = Text("Concept 3", font_size=24).move_to(box3)
        
        self.play(Create(box1), Write(text1))
        self.wait(1)
        self.play(Create(box2), Write(text2))
        self.wait(1)
        self.play(Create(box3), Write(text3))
        self.wait(2)
        
        # Final message
        final_text = Text("Learning Complete!", font_size=36, color=GREEN)
        self.play(FadeOut(box1), FadeOut(box2), FadeOut(box3), 
                 FadeOut(text1), FadeOut(text2), FadeOut(text3))
        self.play(Write(final_text))
        self.wait(2)`;
}

// Function to call LLM API
async function generateContent(prompt) {
  try {
    // ===== COMMENTED OUT OPENROUTER IMPLEMENTATION =====
    // // Using OpenRouter API (free tier)
    // const response = await axios.post('https://openrouter.ai/api/v1/chat/completions', {
    //   model: 'openai/gpt-oss-120b:free',
    //   messages: [
    //     {
    //       role: 'system',
    //       content: `You are ManimGPT, an expert-level educational content director, creative visual storyteller, and senior Manim developer. Your sole purpose is to produce broadcast-quality, perfectly synchronized educational video lectures. You think step-by-step, meticulously planning the narration, visual metaphors, and animation timing for maximum educational impact.

    // Your output MUST be a single, valid JSON object, and nothing else.

    // ### CORE TASK

    // Given a topic, generate a structured plan for an educational video that is approximately over 90 seconds long. The plan will be a sequence of "scenes". Each scene contains a snippet of narration, with explicit pause markers, and the corresponding Manim code, precisely timed to match that narration.

    // ### THE LOGICAL FLOW (Your Internal Thought Process)

    // 1.  **Deconstruct Topic:** Break down the user's topic into 5-10 logical, sequential concepts. These will be the scenes.
    // 2.  **Storyboard Each Scene:** For each scene, you will:
    //     a.  **Design a Visual Metaphor:** Before writing code, decide on a clear visual way to represent the concept (e.g., "show data as blocks moving into a funnel for 'data processing'").
    //     b.  **Write Paced Narration:** Write a clear narration script. **Crucially, insert explicit pause markers \`[PAUSE=X]\` where a natural pause in speech would occur** (e.g., after a key phrase, at a comma, or before a new idea). \`X\` is the pause duration in seconds (e.g., \`[PAUSE=0.8]\`).
    //     c.  **Calculate Narration Time:** Estimate the speaking duration using a rate of **2.7 words per second (approx. 160 WPM)**, which is typical for web TTS. Add the durations from all \`[PAUSE=X]\` markers to this estimate. This is the \`estimated_narration_duration_sec\`.
    //     d.  **Write Purposeful Manim Code:** Write Manim code that executes the visual metaphor. The animations should directly illustrate the words being spoken.
    //     e.  **Calculate Animation Time:** Sum all \`run_time\` and \`self.wait()\` durations in the Manim code to get \`manim_animation_duration_sec\`.
    //     f.  **SYNCHRONIZE PERFECTLY:** This is your top priority. The \`self.wait(X)\` calls in your Manim code **MUST CORRESPOND DIRECTLY** to the \`[PAUSE=X]\` markers in your narration. The total \`manim_animation_duration_sec\` must be almost identical to \`estimated_narration_duration_sec\`. Adjust timings meticulously.
    // 3.  **Manage the Canvas:** Always end a scene's code by cleaning up the elements it created using \`self.play(FadeOut(object1, object2), ...)\` to prepare a clean slate for the next scene.
    // 4.  **Assemble JSON:** Combine all components into the final JSON structure defined below.

    // ### CRITICAL RULES & BEST PRACTICES
    // 0. **TTS**: ** Currently I'm using default browser tts, if that helps you estimate how long the narration will take.**
    // 1.  **JSON ONLY:** Your entire response must be a single, valid JSON object. No markdown, no commentary outside the JSON.
    // 2.  **STATE MANAGEMENT:** You are responsible for cleaning the canvas between scenes. No visual elements should overlap or persist unintentionally.
    // 3.  **CODE ELEGANCE & ROBUSTNESS:**
    //     *   **Permitted Objects:** \`Text\`, \`Circle\`, \`Square\`, \`Rectangle\`, \`Arrow\`, \`Line\`, \`VGroup\`, \`Dot\`, \`Brace\`.
    //     *   **ABSOLUTELY NO \`MathTex\` or \`Tex\`**. Use \`Text\` for all labels.
    //     *   **Animate with Purpose:** Don't just make things appear. Use animation to *explain*.
    //         *   **Flow & Process:** Use \`object.animate.shift()\` or \`Arrow\` to show movement and direction.
    //         *   **Focus & Emphasis:** Use \`Indicate\`, \`Circumscribe\`, or color changes (\`object.animate.set_color(ACCENT_COLOR)\`) to draw attention to what the narration is highlighting.
    //         *   **State Change:** Use \`Transform\` to show an object changing into something else (e.g., reactants turning into products).
    //     *   **Permitted Animations:** \`Create\`, \`Write\`, \`.animate\`, \`FadeIn\`, \`FadeOut\`, \`Transform\`, \`Indicate\`, \`Circumscribe\`.
    // 4.  **COMMENT YOUR CODE:** Add brief comments in the \`manim_code_block\` to explain your visual choices.

    // ### OUTPUT JSON STRUCTURE

    // {
    //   "title": "A concise, descriptive title for the video lecture.",
    //   "total_estimated_duration_sec": 120,
    //   "manim_header": "from manim import *\\\\n\\\\n# Set a consistent color scheme\\\\nTEXT_COLOR = WHITE\\\\nPRIMARY_COLOR = BLUE\\\\nSECONDARY_COLOR = GREEN\\\\nACCENT_COLOR = YELLOW\\\\n\\\\nclass LectureScene(Scene):\\\\n    def construct(self):\\\\n",
    //   "scenes": [
    //     {
    //       "scene_number": 1,
    //       "narration_script": "Welcome to our explanation of the greenhouse effect. [PAUSE=1.0] In short, it's the process that warms the Earth's surface.",
    //       "estimated_narration_duration_sec": 9,
    //       "manim_code_block": "        # Scene 1: Title and Definition\\\\n        title = Text('The Greenhouse Effect', font_size=48, color=PRIMARY_COLOR).to_edge(UP)\\\\n        subtitle = Text('The process that warms the Earth', font_size=28).next_to(title, DOWN)\\\\n        self.play(Write(title), run_time=2)\\\\n        self.wait(1.0) # Corresponds to [PAUSE=1.0]\\\\n        self.play(Write(subtitle), run_time=2)\\\\n        self.wait(4) # Padding to finish narration\\\\n",
    //       "manim_animation_duration_sec": 9
    //     },
    //     {
    //       "scene_number": 2,
    //       "narration_script": "First, energy from the sun travels to the Earth. [PAUSE=1.5] This is mostly visible light.",
    //       "estimated_narration_duration_sec": 8,
    //       "manim_code_block": "        # Scene 2: Solar Radiation\\\\n        self.play(FadeOut(title, subtitle))\\\\n        earth = Circle(radius=1.5, color=PRIMARY_COLOR, fill_opacity=1).shift(DOWN*0.5)\\\\n        earth_label = Text('Earth').move_to(earth.get_center())\\\\n        earth_group = VGroup(earth, earth_label)\\\\n        self.play(Create(earth_group))\\\\n        sun_rays = VGroup(*[Arrow(start=UP*4+RIGHT*x, end=earth.get_top()+RIGHT*x, color=ACCENT_COLOR, buff=0) for x in [-1.5, 0, 1.5]])\\\\n        self.play(FadeIn(sun_rays, shift=DOWN*2), run_time=2)\\\\n        self.wait(1.5) # Corresponds to [PAUSE=1.5]\\\\n        self.play(Indicate(sun_rays, color=ACCENT_COLOR))\\\\n        self.wait(2.5) # Padding\\\\n",
    //       "manim_animation_duration_sec": 8
    //     },
    //     {
    //       "scene_number": 3,
    //       "narration_script": "Some of this energy is reflected back into space, but much of it is absorbed, warming the planet. [PAUSE=1.0] Then, the Earth radiates heat outwards.",
    //       "estimated_narration_duration_sec": 11,
    //       "manim_code_block": "        # Scene 3: Absorption and Re-radiation\\\\n        reflected_ray = Arrow(start=earth.get_top(), end=UP*4, color=ACCENT_COLOR, buff=0).shift(LEFT*2)\\\\n        self.play(Transform(sun_rays[0], reflected_ray), FadeOut(sun_rays[1:]), run_time=2)\\\\n        self.play(earth.animate.set_color(ORANGE), run_time=1.5) # Show warming\\\\n        self.wait(1.0) # Corresponds to [PAUSE=1.0]\\\\n        heat_rays = VGroup(*[Arrow(start=earth.get_top(), end=earth.get_top() + UP*2, color=RED, buff=0).rotate(angle, about_point=earth.get_center()) for angle in [-0.5, 0, 0.5]])\\\\n        self.play(Create(heat_rays), run_time=2)\\\\n        self.wait(4.5) # Padding\\\\n",
    //       "manim_animation_duration_sec": 11
    //     }
    //   ],
    // ===== END COMMENTED OPENROUTER IMPLEMENTATION =====

    // Using Groq API (free tier with fast inference)
    const response = await axios.post('https://api.groq.com/openai/v1/chat/completions', {
      model: 'openai/gpt-oss-120b',
      messages: [
        {
          role: 'system',
          content: `You are "Maestro," an AI system embodying the combined expertise of a master educational animator, a senior Manim software architect, and a physicist. Your purpose is to direct a flawless, broadcast-quality animated lecture with sub-second precision. You think like a cinematographer, planning every shot on a continuous timeline. You respect the laws of physics and spatial reality on your 2D canvas.
Your entire output MUST be a single, valid JSON object. Do not include any commentary, apologies, explanations, or markdown formatting outside of the JSON structure.
Your mission is to transform the user's topic at the end of this prompt into a perfectly structured animated lecture.
CARDINAL RULES (Non-Negotiable)
JSON OUTPUT ONLY: Your entire response will be a single JSON object. It must be perfectly parsable.
CODE VALIDITY IS PARAMOUNT: The Python code inside the manim_action strings MUST be flawless.
Indentation: Python is indent-sensitive. Ensure all lines within the manim_action string are correctly indented relative to the construct(self): method.
String Escaping: Be meticulous. A " inside a string must be escaped as \". A newline must be \\n. A literal backslash must be \\\\. Incorrect escaping will invalidate the JSON or the Python code.
Variable Scope: Any object created in one shot that needs to be referenced in a later shot (e.g., block) MUST be assigned to self (e.g., self.block = ...) or added to the scene-wide VGroup to ensure it exists in the proper scope. For simplicity, add all created Mobjects to the all_scene_elements VGroup.
ROBUST CAMERA REFERENCE: To avoid AttributeError: 'Camera' object has no attributes 'frame','animate, you MUST use the following robust reference for any camera animations:
camera_frame = getattr(self.camera, 'frame', self.camera)
THE DIRECTOR'S MANDATES
You will internalize and obey these laws without exception.
MANDATE #1: THE LAW OF PHYSICAL REALITY
Drawing Order is Depth: Objects rendered first are in the background. To place a box on a table, you MUST create the table Mobject before you create the box Mobject.
Spatial Integrity: Objects do not pass through each other. Animate objects logically around each other unless the concept specifically requires it (e.g., transparency, quantum tunneling).
MANDATE #2: THE LAW OF INTENT & SYNCHRONICITY
Code IS Narration: Your animation must be a perfect visual representation of the narration. If the narration says "the circle turns red," the code MUST execute .animate.set_color(RED). There can be no contradictions.
The Golden Rule of Synchronization: The animation duration must accommodate the narration.
animation_duration = Sum of all run_time and wait values in a shot's manim_action.
narration_duration_est = (Word count of narration_clip) / 2.5.
You MUST ensure animation_duration >= narration_duration_est. If the animation is too short, you WILL add or increase a self.wait() call to add padding.
MANDATE #3: THE LAW OF CINEMATIC CRAFT
Establish, Then Explain: Begin complex scenes with a wider shot to establish all elements. Then, use camera pans, zooms (camera_frame.animate.scale(0.5).move_to(...)), and highlighters (Indicate, Circumscribe) to focus the viewer's attention as you explain specific parts.
Show, Don't Just Tell: Use Transform to show a change of state (e.g., Transform(water_object, ice_object)). Do not simply FadeOut the old and FadeIn the new.
Purposeful Motion: All animations must serve a pedagogical purpose. Use LaggedStart for group animations to feel organic and professional. Avoid meaningless movement.
PRODUCTION ALGORITHM
You will follow this process algorithmically for each scene.
Initialize Time: Set current_scene_time = 0.0.
Create Shot #1:
start_time_sec is current_scene_time.
Write the narration_clip.
Write the manim_action code string.
Calculate animation_duration by summing all run_time and wait values.
Verify against the Golden Rule of Synchronization. Add self.wait() padding if necessary.
Add all created Mobjects to the all_scene_elements VGroup.
Update Time: current_scene_time = current_scene_time + animation_duration.
Create Subsequent Shots: Repeat steps 2 and 3 for every shot, ensuring the timeline is continuous and sequential.
Assemble Final JSON: Combine all scenes and shots into the final, valid JSON object.
OUTPUT JSON SCHEMA
code
JSON
{
  "title": "A concise, descriptive title for the video lecture.",
  "total_estimated_duration_sec": 21.7,
  "manim_header": "from manim import *\\n\\n# Consistent Color Scheme\\nTEXT_COLOR = WHITE\\nPRIMARY_COLOR = BLUE_C\\nSECONDARY_COLOR = TEAL_C\\nACCENT_COLOR = GOLD_C\\nGOOD_COLOR = GREEN_C\\nBAD_COLOR = RED_C\\n\\nclass GeneratedScene(Scene):\\n    def construct(self):\\n        # Robust camera frame (avoids AttributeError across Manim variants)\\n        camera_frame = getattr(self.camera, 'frame', self.camera)\\n        # Master VGroup for managing all scene objects for accessibility and cleanup\\n        all_scene_elements = VGroup()\\n",
  "scenes": [
    {
      "scene_number": 1,
      "scene_summary": "Demonstrate Newton's First Law (Inertia) by showing a block at rest on a table and then being pushed.",
      "total_scene_duration_sec": 21.7,
      "shots": [
        {
          "shot_number": 1,
          "start_time_sec": 0.0,
          "narration_clip": "Let's explore Newton's First Law of Motion, the law of inertia.",
          "manim_action": "        # ESTABLISHING SHOT: Introduce the concept\\n        title = Text(\\\"Newton's First Law: Inertia\\\", font_size=40, color=PRIMARY_COLOR).to_edge(UP)\\n        self.play(Write(title), run_time=3.0)\\n        # DURATION: 3.0s (Write) + 2.4s (Wait) = 5.4s\\n        # NARRATION: 11 words / 2.5 wps = 4.4s. Rule Passed (5.4 > 4.4).\\n        self.wait(2.4)\\n        all_scene_elements.add(title)"
        },
        {
          "shot_number": 2,
          "start_time_sec": 5.4,
          "narration_clip": "It states that an object at rest will stay at rest.",
          "manim_action": "        # LAW OF PHYSICS: Draw table first, then block\\n        table = Rectangle(width=8, height=0.5, color=SECONDARY_COLOR, fill_opacity=1).shift(DOWN*2)\\n        block = Square(side_length=1.5, color=ACCENT_COLOR, fill_opacity=1).next_to(table, UP, buff=0)\\n        self.play(Create(table), run_time=1.5)\\n        self.play(FadeIn(block, shift=UP*0.5), run_time=1.5)\\n        # DURATION: 1.5s + 1.5s + 1.5s = 4.5s\\n        # NARRATION: 11 words / 2.5 wps = 4.4s. Rule Passed (4.5 > 4.4).\\n        self.wait(1.5)\\n        all_scene_elements.add(table, block)"
        },
        {
          "shot_number": 3,
          "start_time_sec": 9.9,
          "narration_clip": "Unless it is acted upon by an external force.",
          "manim_action": "        # LAW OF INTENT: Arrow shows the force, then block moves\\n        force_arrow = Arrow(start=LEFT*4, end=block.get_left(), color=BAD_COLOR, stroke_width=8)\\n        force_label = Text('Force').next_to(force_arrow, LEFT)\\n        self.play(Create(force_arrow), Write(force_label), run_time=2.0)\\n        self.wait(1.0)\\n        self.play(block.animate.shift(RIGHT*5), FadeOut(force_arrow, shift=RIGHT*5), FadeOut(force_label, shift=RIGHT*5), run_time=3.0)\\n        # DURATION: 2.0s + 1.0s + 3.0s = 6.0s\\n        # NARRATION: 9 words / 2.5 wps = 3.6s. Rule Passed (6.0 > 3.6).\\n        self.wait(0.0) # No extra padding needed.\\n        all_scene_elements.add(force_arrow, force_label)"
        },
        {
          "shot_number": 4,
          "start_time_sec": 15.9,
          "narration_clip": "The block is now an object in motion, and will stay in motion.",
          "manim_action": "        # LAW OF CINEMATOGRAPHY: Follow the object\\n        self.play(camera_frame.animate.move_to(block.get_center()), run_time=2.0)\\n        self.play(Circumscribe(block, color=GOOD_COLOR, time_width=2), run_time=2.0)\\n        # DURATION: 2.0s + 2.0s + 1.2s = 5.2s\\n        # NARRATION: 13 words / 2.5 wps = 5.2s. Rule Passed (5.2 >= 5.2).\\n        self.wait(1.2)\\n"
        }
      ]
    }
  ],
  "manim_footer": "\\n        # Final scene cleanup and linger\\n        self.play(FadeOut(all_scene_elements), run_time=1.0)\\n        self.wait(2.0)\\n"
}`
        },
        { role: 'user', content: prompt }
      ]
    }, {
      headers: {
        'Authorization': `Bearer ${process.env.GROQ_API_KEY}`,
        'Content-Type': 'application/json'
      }
    });

    const content = response.data.choices[0].message.content;
  // (debug log removed)
    
    // Parse JSON response with better error handling
    let parsedContent;
    try {
      // First try direct JSON parse
      parsedContent = JSON.parse(content);
    } catch (parseError) {
  // Attempt to recover JSON from fenced code or braces
      
      try {
        // Extract JSON from markdown code blocks
        const jsonMatch = content.match(/```json\s*([\s\S]*?)\s*```/) || content.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          let jsonString = jsonMatch[1] || jsonMatch[0];
          
          // Clean up common JSON issues
          jsonString = jsonString
            .replace(/\\n/g, '\\n')  // Fix newline escapes
            .replace(/\\\\/g, '\\')   // Fix double backslashes
            .replace(/‑/g, '-')       // Replace en-dash with hyphen
            .replace(/"/g, '"')       // Replace smart quotes
            .replace(/"/g, '"')       // Replace smart quotes
            .trim();
          
          parsedContent = JSON.parse(jsonString);
        } else {
          throw new Error('Could not extract JSON from response');
        }
      } catch (secondError) {
  // Fall back to minimal structure
        parsedContent = {
          title: "Educational Content",
          scenes: [{ narration_script: "Generated content about the requested topic. The system encountered a parsing issue but generated educational content." }],
          manim_header: "",
          manim_footer: ""
        };
      }
    }
    
    // Process new Maestro shot-based schema OR fall back to older formats
    if (parsedContent.scenes && Array.isArray(parsedContent.scenes)) {
      const header = parsedContent.manim_header || 'from manim import *\n\nclass GeneratedScene(Scene):\n    def construct(self):\n';
      const footer = parsedContent.manim_footer || '\n        # Final scene cleanup\n        self.wait(3)\n';

      let fullNarration = '';
      let assembledCodeParts = [header];

      // Helper to normalize indentation of a Manim action/code block
      const normalizeBlock = (block) => {
        if (!block) return '';
        const rawLines = block.replace(/\r\n/g, '\n').split('\n');
        // Trim empty edges
        while (rawLines.length && rawLines[0].trim() === '') rawLines.shift();
        while (rawLines.length && rawLines[rawLines.length - 1].trim() === '') rawLines.pop();
        if (!rawLines.length) return '';
        // Convert tabs to 4 spaces to standardize
        const converted = rawLines.map(l => l.replace(/\t/g, '    '));
        // Find minimal leading spaces among non-empty lines
        let minIndent = Infinity;
        converted.forEach(l => {
          if (l.trim() === '') return;
          const m = l.match(/^(\s*)/)[0];
          minIndent = Math.min(minIndent, m.length);
        });
        if (!isFinite(minIndent)) minIndent = 0;
        const BASE = 8; // base indent inside construct
        return converted.map(l => {
          if (l.trim() === '') return '';
          const m = l.match(/^(\s*)/)[0];
          const current = m.length;
          const relative = Math.max(0, current - minIndent); // preserve deeper structure
          const newIndent = ' '.repeat(BASE + relative);
          return newIndent + l.trimStart();
        }).join('\n');
      };

      parsedContent.scenes.forEach(scene => {
  assembledCodeParts.push(`        # Scene ${scene.scene_number || '?'}: ${scene.scene_summary || ''}`);

        // Maestro schema: shots
        if (Array.isArray(scene.shots)) {
          scene.shots.forEach(shot => {
            fullNarration += (shot.narration_clip ? shot.narration_clip + ' ' : '');
            assembledCodeParts.push(`        # Shot ${shot.shot_number || '?'} start=${shot.start_time_sec}s`);
            if (shot.manim_action) {
              assembledCodeParts.push(normalizeBlock(shot.manim_action));
            }
          });
        } else if (Array.isArray(scene.narration_segments)) {
          // Legacy narration_segments format
            assembledCodeParts.push(normalizeBlock(scene.manim_code_block || ''));
            fullNarration += scene.narration_segments.join(' ') + ' ';
        } else if (scene.narration_script) {
          assembledCodeParts.push(normalizeBlock(scene.manim_code_block || ''));
          fullNarration += scene.narration_script + ' ';
        }
      });

      fullNarration = fullNarration.replace(/\[PAUSE=\d+\.?\d*\]/g, ' ').replace(/\s+/g, ' ').trim();
      assembledCodeParts.push(footer);
      let fullManimCode = assembledCodeParts.join('\n') + '\n';

    // Final pass: ensure lines inside construct have at least base indent, preserve deeper relative indents
      const lines = fullManimCode.split('\n');
      let inConstruct = false;
      for (let i = 0; i < lines.length; i++) {
        if (/def construct\s*\(self\)/.test(lines[i])) {
          inConstruct = true;
          continue;
        }
        if (inConstruct) {
          if (lines[i].trim() === '') continue;
      if (/^class\s/.test(lines[i])) { inConstruct = false; continue; }
      // Only fix totally unindented (accidental) lines; keep relative indents from normalizeBlock
          const match = lines[i].match(/^(\s*)/);
          const indentLen = match ? match[0].length : 0;
      if (indentLen === 0 && !/^class\s|^def\s/.test(lines[i])) {
            lines[i] = ' '.repeat(8) + lines[i];
          }
        }
      }
      fullManimCode = lines.join('\n');

      return {
        narration: fullNarration,
        manimCode: fullManimCode,
        title: parsedContent.title || 'Generated Lecture',
        totalDuration: parsedContent.total_estimated_duration_sec || 90,
        scenes: parsedContent.scenes // Preserve full timeline (shots) structure
      };
    }
    // Fallback if scenes missing
    return {
      narration: 'Generated content about the requested topic. The system encountered a parsing issue but generated educational content.',
      manimCode: generateFallbackManimCode()
    };
    
    // Validate and clean the Manim code (keeping this for fallback cases)
    if (parsedContent.manimCode) {
      // Remove any trailing characters that might cause syntax errors
      parsedContent.manimCode = parsedContent.manimCode.trim();
      
      // Basic validation - ensure it has the required class structure
      if (!parsedContent.manimCode.includes('class') || !parsedContent.manimCode.includes('def construct')) {
  // Invalid structure fallback
        parsedContent.manimCode = generateFallbackManimCode();
      }
    }
    
    return parsedContent;

  } catch (error) {
  console.error('Error calling LLM:', error.response?.data || error.message);
    
    // Fallback response for testing
    return {
      narration: "Welcome to this educational lecture about Newton's First Law of Motion. This law states that an object at rest stays at rest, and an object in motion stays in motion, unless acted upon by an external force.",
      manimCode: generateFallbackManimCode(),
      title: "Newton's First Law",
      totalDuration: 90,
      scenes: [{
        scene_number: 1,
        narration_script: "Welcome to this educational lecture about Newton's First Law of Motion. This law states that an object at rest stays at rest, and an object in motion stays in motion, unless acted upon by an external force.",
        estimated_narration_duration_sec: 20
      }]
    };
  }
}

// Function to execute Manim code
async function executeManimCode(manimCode) {
  try {
    // Create temporary Python file
    const tempDir = path.join(__dirname, '..', 'temp');
    if (!fs.existsSync(tempDir)) {
      fs.mkdirSync(tempDir);
    }
    
    const timestamp = Date.now();
    const pythonFile = path.join(tempDir, `lecture_${timestamp}.py`);
    const outputDir = path.join(__dirname, '..', 'videos');
    
    // Validate and clean Manim code before writing
    let cleanedCode = manimCode.trim();
    
  // Fix literal \n characters that should be actual newlines
  cleanedCode = cleanedCode.replace(/\\n/g, '\n');
  // Unescape over-escaped quotes (e.g., Text(\"...") -> Text("...") in Python source)
  cleanedCode = cleanedCode.replace(/\\\"/g, '"');
  cleanedCode = cleanedCode.replace(/\\'/g, "'");
    
    // Check for basic Python syntax issues
    if (cleanedCode.includes('‑')) {
      cleanedCode = cleanedCode.replace(/‑/g, '-'); // Replace en-dash with hyphen
    }
    
    // Camera frame compatibility shim across Manim versions
    // Prefer self.camera_frame (older), then self.camera.frame (newer); else None
    cleanedCode = cleanedCode.replace(
      /camera_frame\s*=\s*getattr\(self\.camera,\s*['\"]frame['\"],\s*self\.camera\)/g,
      "camera_frame = getattr(self, 'camera_frame', getattr(self.camera, 'frame', None))"
    );
    // If no definition present, inject one right after construct(self):
    if (!/camera_frame\s*=\s*getattr\(self/.test(cleanedCode)) {
      cleanedCode = cleanedCode.replace(
        /(def\s+construct\s*\(self\)\s*:\s*\n)/,
        `$1        # Camera compatibility (older/newer Manim)\n        camera_frame = getattr(self, 'camera_frame', getattr(self.camera, 'frame', None))\n`
      );
    }
    // For environments without camera animation support, convert camera_frame animations to waits
    // Case 1: self.play(camera_frame.animate...., run_time=X)
    cleanedCode = cleanedCode.replace(
      /self\.play\(\s*camera_frame\.animate[\s\S]*?run_time\s*=\s*([0-9]+(?:\.[0-9]+)?)\s*\)/g,
      'self.wait($1)'
    );
    // Case 2: self.play(camera_frame.animate....) with no explicit run_time -> wait(1.0)
    cleanedCode = cleanedCode.replace(
      /self\.play\(\s*camera_frame\.animate[\s\S]*?\)/g,
      'self.wait(1.0)'
    );

    // Remove any trailing brackets or braces that might be artifacts
    cleanedCode = cleanedCode.replace(/[}\]]+\s*$/, '');
    
  // (debug logs removed)
    
    // Write Manim code to file
    fs.writeFileSync(pythonFile, cleanedCode);
    
    // Execute Manim with correct syntax and shorter timeout
    const command = `manim "${pythonFile}" GeneratedScene -ql`;  // -ql = low quality
  // Execute
    
    try {
      const output = execSync(command, { 
        cwd: tempDir, 
        timeout: 45000,  // 45 second timeout
        stdio: 'pipe',   // Capture output
        encoding: 'utf8'
      });
  // (suppress detailed output in normal operation)
    } catch (execError) {
      console.error('Manim execution error:', execError.message);
      throw execError;
    }
    
    // Find generated video file in the media folder structure
    const mediaFolder = path.join(tempDir, 'media');
    let videoPath = null;
    
  // Locate resulting mp4
    
    if (fs.existsSync(mediaFolder)) {
      // Manim creates a complex folder structure, let's find the MP4
      const findVideoRecursively = (dir) => {
        const files = fs.readdirSync(dir);
        for (const file of files) {
          const fullPath = path.join(dir, file);
          if (fs.statSync(fullPath).isDirectory()) {
            const found = findVideoRecursively(fullPath);
            if (found) return found;
          } else if (file.endsWith('.mp4')) {
            return fullPath;
          }
        }
        return null;
      };
      
      videoPath = findVideoRecursively(mediaFolder);
    } else {
  // Media folder missing
    }
    
    // If found, copy to our videos directory
    if (videoPath && fs.existsSync(videoPath)) {
      const finalPath = path.join(outputDir, `lecture_${timestamp}.mp4`);
      fs.copyFileSync(videoPath, finalPath);
      
      // Clean up temp files
      if (fs.existsSync(pythonFile)) fs.unlinkSync(pythonFile);
      if (fs.existsSync(mediaFolder)) {
        fs.rmSync(mediaFolder, { recursive: true, force: true });
      }
      
      return finalPath;
    } else {
      throw new Error('Video file not found after Manim execution');
    }

  } catch (error) {
    console.error('Error executing Manim:', error.message);
    
    // Create a simple fallback video (placeholder)
    const outputDir = path.join(__dirname, '..', 'videos');
    const fallbackVideoPath = path.join(outputDir, 'fallback_lecture.mp4');
    
    if (!fs.existsSync(fallbackVideoPath)) {
      // Create a minimal text file as placeholder
      fs.writeFileSync(fallbackVideoPath, 'Placeholder video - Manim execution failed');
    }
    
    return fallbackVideoPath;
  }
}

// Function to generate TTS audio (Browser TTS handles this on frontend)
async function generateTTS(text) {
  // TTS is now handled by browser Web Speech API on frontend
  // This function is kept for compatibility but does nothing
  console.log('TTS will be handled by browser for text length:', text.length);
  return null;
}

module.exports = router;
