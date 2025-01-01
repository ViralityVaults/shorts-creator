const { createFFmpeg, fetchFile } = FFmpeg;
const ffmpeg = createFFmpeg({ log: true });

// API keys
const CLARIFAI_PAT = '9ff45cfd14e649c2b76300b463387040'; // Your Clarifai PAT
const OPENAI_API_KEY = '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'; // Replace with your OpenAI API key

// Clarifai workflow URLs
const EMOTION_WORKFLOW_URL = 'https://api.clarifai.com/v2/workflows/emotion/workflows/face-sentiment-recognition-workflow-jlj161';
const FACE_DETECTION_WORKFLOW_URL = 'https://api.clarifai.com/v2/workflows/face-detection/workflows/face-detection-workflow-5cbii';
const GENERAL_WORKFLOW_URL = 'https://api.clarifai.com/v2/workflows/general/workflows/general-image-recognition-workflow-3d5qu';

// Function to process the video
async function processVideo(videoFile) {
  if (!videoFile) {
    alert('Please upload a video!');
    return;
  }

  // Show loading state
  const button = document.querySelector('button');
  button.innerText = 'Processing...';
  button.disabled = true;

  try {
    // Load FFmpeg
    if (!ffmpeg.isLoaded()) {
      await ffmpeg.load();
    }

    // Write the uploaded file to FFmpeg's file system
    const videoName = 'input.mp4';
    ffmpeg.FS('writeFile', videoName, await fetchFile(videoFile));

    // Step 1: Extract key moments based on facial expressions and objects
    const keyMoments = await findKeyMoments(videoName);

    // Step 2: Create short clips based on key moments
    const outputDiv = document.getElementById('output');
    outputDiv.innerHTML = ''; // Clear previous output
    outputDiv.style.display = 'block';

    for (let i = 0; i < keyMoments.length; i++) {
      const startTime = keyMoments[i];
      const shortName = `short_${i + 1}.mp4`;

      // Trim and resize the video
      await ffmpeg.run(
        '-i', videoName,
        '-vf', 'scale=1080:1920',
        '-ss', startTime.toString(),
        '-t', '30', // Each short is 30 seconds long
        shortName
      );

      // Step 3: Add subtitles using OpenAI Whisper API
      await addSubtitles(shortName);

      // Step 4: Analyze the short clip with Clarifai
      const analysis = await analyzeShortClip(shortName);

      // Step 5: Generate download link
      const data = ffmpeg.FS('readFile', shortName);
      const videoBlob = new Blob([data.buffer], { type: 'video/mp4' });
      const videoUrl = URL.createObjectURL(videoBlob);

      // Display the short clip
      const shortContainer = document.createElement('div');
      shortContainer.className = 'short-container';

      const videoElement = document.createElement('video');
      videoElement.src = videoUrl;
      videoElement.controls = true;

      const downloadLink = document.createElement('a');
      downloadLink.href = videoUrl;
      downloadLink.download = shortName;
      downloadLink.innerText = `Download Short ${i + 1}`;

      const analysisDiv = document.createElement('div');
      analysisDiv.innerHTML = `<pre>${JSON.stringify(analysis, null, 2)}</pre>`;

      shortContainer.appendChild(videoElement);
      shortContainer.appendChild(downloadLink);
      shortContainer.appendChild(analysisDiv);
      outputDiv.appendChild(shortContainer);
    }
  } catch (error) {
    console.error('Error processing video:', error);
    alert('An error occurred while processing the video.');
  } finally {
    // Reset button
    button.innerText = 'Process Video';
    button.disabled = false;
  }
}

// Helper function to find key moments based on facial expressions and objects
async function findKeyMoments(videoName) {
  const videoData = ffmpeg.FS('readFile', videoName);
  const videoBlob = new Blob([videoData.buffer], { type: 'video/mp4' });
  const videoUrl = URL.createObjectURL(videoBlob);

  // Analyze the video using Clarifai workflows
  const emotionAnalysis = await clarifaiAnalyze(videoUrl, EMOTION_WORKFLOW_URL);
  const faceAnalysis = await clarifaiAnalyze(videoUrl, FACE_DETECTION_WORKFLOW_URL);
  const generalAnalysis = await clarifaiAnalyze(videoUrl, GENERAL_WORKFLOW_URL);

  // Extract key moments based on analysis results
  const keyMoments = [];
  if (emotionAnalysis.results) {
    emotionAnalysis.results.forEach((result) => {
      if (result.data.concepts.some((concept) => concept.value > 0.8)) { // High confidence in emotion
        keyMoments.push(result.time);
      }
    });
  }
  if (faceAnalysis.results) {
    faceAnalysis.results.forEach((result) => {
      if (result.data.regions.length > 0) { // Faces detected
        keyMoments.push(result.time);
      }
    });
  }
  if (generalAnalysis.results) {
    generalAnalysis.results.forEach((result) => {
      if (result.data.concepts.some((concept) => concept.value > 0.8)) { // High confidence in objects
        keyMoments.push(result.time);
      }
    });
  }

  // Remove duplicates and sort key moments
  return [...new Set(keyMoments)].sort((a, b) => a - b);
}

// Function to add subtitles using OpenAI Whisper API
async function addSubtitles(videoName) {
  const videoData = ffmpeg.FS('readFile', videoName);
  const videoBlob = new Blob([videoData.buffer], { type: 'video/mp4' });

  // Extract audio from the video
  const audioName = 'audio.wav';
  await ffmpeg.run(
    '-i', videoName,
    '-q:a', '0',
    '-map', 'a',
    audioName
  );

  // Convert audio to a format compatible with Whisper API
  const audioData = ffmpeg.FS('readFile', audioName);
  const audioBlob = new Blob([audioData.buffer], { type: 'audio/wav' });

  // Transcribe audio using OpenAI Whisper API
  const formData = new FormData();
  formData.append('file', audioBlob, 'audio.wav');
  formData.append('model', 'whisper-1');

  try {
    const response = await fetch('https://api.openai.com/v1/audio/transcriptions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${OPENAI_API_KEY}`,
      },
      body: formData,
    });

    if (!response.ok) {
      throw new Error(`OpenAI API request failed: ${response.statusText}`);
    }

    const result = await response.json();
    const transcript = result.text;

    // Create subtitles file
    const subtitleFile = 'subtitles.srt';
    const subtitles = generateSRT(transcript); // Convert transcript to SRT format
    ffmpeg.FS('writeFile', subtitleFile, new TextEncoder().encode(subtitles));

    // Overlay subtitles on the video using FFmpeg
    await ffmpeg.run(
      '-i', videoName,
      '-vf', `subtitles=${subtitleFile}`,
      'output_with_subtitles.mp4'
    );

    // Replace the original video with the subtitled version
    ffmpeg.FS('unlink', videoName);
    ffmpeg.FS('rename', 'output_with_subtitles.mp4', videoName);
  } catch (error) {
    console.error('Error adding subtitles:', error);
  }
}

// Helper function to generate SRT format subtitles
function generateSRT(transcript) {
  // Split transcript into lines
  const lines = transcript.split('. '); // Simple split by sentences
  let srtContent = '';

  lines.forEach((line, index) => {
    srtContent += `${index + 1}\n`;
    srtContent += `00:00:${index * 2},000 --> 00:00:${index * 2 + 2},000\n`;
    srtContent += `${line}\n\n`;
  });

  return srtContent;
}

// Function to analyze a short clip with Clarifai
async function analyzeShortClip(videoName) {
  const videoData = ffmpeg.FS('readFile', videoName);
  const videoBlob = new Blob([videoData.buffer], { type: 'video/mp4' });
  const videoUrl = URL.createObjectURL(videoBlob);

  // Analyze with Clarifai workflows
  const emotionAnalysis = await clarifaiAnalyze(videoUrl, EMOTION_WORKFLOW_URL);
  const faceAnalysis = await clarifaiAnalyze(videoUrl, FACE_DETECTION_WORKFLOW_URL);
  const generalAnalysis = await clarifaiAnalyze(videoUrl, GENERAL_WORKFLOW_URL);

  return { emotionAnalysis, faceAnalysis, generalAnalysis };
}

// Function to call Clarifai API
async function clarifaiAnalyze(imageUrl, workflowUrl) {
  const response = await fetch(workflowUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Key ${CLARIFAI_PAT}`,
    },
    body: JSON.stringify({
      inputs: [{ data: { image: { url: imageUrl } } }],
    }),
  });

  if (!response.ok) {
    throw new Error(`Clarifai API request failed: ${response.statusText}`);
  }

  const data = await response.json();
  return data;
}

// Example usage
document.getElementById('processVideo').onclick = async () => {
  const videoFile = document.getElementById('videoInput').files[0];
  await processVideo(videoFile);
};
